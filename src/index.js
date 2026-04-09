#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Epub from "epub-gen";
import { z } from "zod";

const PAGE_SCHEMA = z.array(
  z.object({
    pageNumber: z.number().int().positive(),
    label: z.string().min(3),
    events: z.array(z.string().min(2)).min(1)
  })
);

const STORY_PAGE_SCHEMA = z.array(
  z.object({
    pageNumber: z.number().int().positive(),
    label: z.string().min(3),
    text: z.string().min(20)
  })
);

const CONTINUITY_ASSET_PLAN_SCHEMA = z.object({
  styleAnchor: z.string().min(10),
  characters: z.array(
    z.object({
      id: z.string().min(2),
      name: z.string().min(2),
      visualDescription: z.string().min(10)
    })
  ),
  scenery: z.array(
    z.object({
      id: z.string().min(2),
      name: z.string().min(2),
      visualDescription: z.string().min(10)
    })
  )
});

const CONTINUITY_SCENE_SCHEMA = z.object({
  pageNumber: z.number().int().positive(),
  sceneDescription: z.string().min(20),
  characterAssetIds: z.array(z.string()),
  sceneryAssetIds: z.array(z.string())
});

function parseArgs(argv) {
  const args = {
    prompt: "",
    title: "My AI Storybook",
    author: "Children's Book Agent",
    pages: 10,
    outDir: "output"
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }

    if (token === "--prompt") args.prompt = argv[++i] ?? "";
    else if (token === "--title") args.title = argv[++i] ?? args.title;
    else if (token === "--author") args.author = argv[++i] ?? args.author;
    else if (token === "--pages") args.pages = Number(argv[++i] ?? args.pages);
    else if (token === "--out") args.outDir = argv[++i] ?? args.outDir;
  }

  if (!args.prompt.trim()) {
    throw new Error("Missing --prompt. Use --help for usage.");
  }

  return args;
}

function printHelp() {
  console.log(`\nChildren's Book Agent (Bun + JavaScript)\n\nUsage:\n  bun run src/index.js --prompt \"A shy dragon learns to sing\" [options]\n\nOptions:\n  --title  <string>   Ebook title (default: My AI Storybook)\n  --author <string>   Ebook author (default: Children's Book Agent)\n  --pages  <number>   Number of pages to create (default: 10)\n  --out    <path>     Output directory (default: output)\n  --help              Show this help\n\nEnvironment:\n  LLAMA_API_URL           Default: http://127.0.0.1:8080/v1/chat/completions\n  LLAMA_MODEL             Default: local-model\n  NANO_BANANA_API_URL     Optional. Endpoint for Google Nano Banana image generation + scene composition\n  NANO_BANANA_API_KEY     Optional auth token sent as Bearer\n  SD_API_URL              Default: http://127.0.0.1:7860/sdapi/v1/txt2img (fallback if Nano Banana fails)\n  SD_STEPS                Default: 30\n  SD_WIDTH                Default: 768\n  SD_HEIGHT               Default: 768\n`);
}

async function callLlama({ system, user }) {
  const url = process.env.LLAMA_API_URL ?? "http://127.0.0.1:8080/v1/chat/completions";
  const model = process.env.LLAMA_MODEL ?? "local-model";

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`llama.cpp API failed (${response.status}): ${body}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("llama.cpp API response missing choices[0].message.content");
  }

  return content;
}

function parseJsonFromModel(text) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

async function withRetry(task, { retries = 2, name = "operation" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt <= retries) {
        const waitMs = 400 * attempt;
        console.warn(`${name} failed on attempt ${attempt}, retrying in ${waitMs}ms...`);
        await Bun.sleep(waitMs);
      }
    }
  }
  throw lastError;
}

async function generateConcept(seedPrompt) {
  const content = await callLlama({
    system: "You create short, age-appropriate children's story concepts.",
    user: `Create one children's book concept from this seed:\n${seedPrompt}\n\nReturn JSON only with keys: title, audience, coreLesson, setting, characters.`
  });
  return parseJsonFromModel(content);
}

async function planPages(concept, pageCount) {
  const content = await callLlama({
    system: "You are a children's book planner.",
    user: `Using this concept:\n${JSON.stringify(concept, null, 2)}\n\nCreate exactly ${pageCount} page beats.\nReturn JSON array only. Each item: { pageNumber, label, events: string[] }`
  });

  const parsed = parseJsonFromModel(content);
  return PAGE_SCHEMA.parse(parsed);
}

async function writePages(concept, beats) {
  const content = await callLlama({
    system: "You write warm, simple, vivid storybook pages for kids ages 4-8.",
    user: `Write page text from this concept and plan.\n\nConcept:\n${JSON.stringify(concept, null, 2)}\n\nPlan:\n${JSON.stringify(beats, null, 2)}\n\nReturn JSON array only. Each item: { pageNumber, label, text }. Keep each page text to 55-95 words.`
  });

  const parsed = parseJsonFromModel(content);
  return STORY_PAGE_SCHEMA.parse(parsed);
}

async function makeImagePrompt(page) {
  const content = await callLlama({
    system: "You convert story text into stable diffusion prompts for illustrated children's books.",
    user: `Create one image prompt for this page. Include character details, setting, mood, camera framing, art style (storybook watercolor), and avoid text overlays.\n\nLabel: ${page.label}\nText: ${page.text}\n\nReturn plain text only.`
  });

  return content.replace(/^"|"$/g, "").trim();
}

async function planContinuityAssets({ concept, beats, storyPages }) {
  const content = await callLlama({
    system: "You plan reusable visual assets for continuity in children's picture books.",
    user: `You must return JSON only.\nGiven this concept, beat plan, and story pages, create a reusable visual asset plan.\n\nConcept:\n${JSON.stringify(concept, null, 2)}\n\nBeats:\n${JSON.stringify(beats, null, 2)}\n\nStory Pages:\n${JSON.stringify(storyPages, null, 2)}\n\nRules:\n- Create stable IDs in kebab-case.\n- Include recurring main characters and important scenery/backgrounds that should persist across pages.\n- styleAnchor should define one consistent illustration style for the whole book.\n\nReturn shape:\n{\n  \"styleAnchor\": string,\n  \"characters\": [{ \"id\": string, \"name\": string, \"visualDescription\": string }],\n  \"scenery\": [{ \"id\": string, \"name\": string, \"visualDescription\": string }]\n}`
  });

  return CONTINUITY_ASSET_PLAN_SCHEMA.parse(parseJsonFromModel(content));
}

async function planPageContinuityScene({ page, assetPlan }) {
  const content = await callLlama({
    system: "You map a story page to reusable visual assets while preserving continuity.",
    user: `Return JSON only.\nGiven this page and asset plan, build a scene composition instruction that reuses only relevant assets.\n\nAsset plan:\n${JSON.stringify(assetPlan, null, 2)}\n\nPage:\n${JSON.stringify(page, null, 2)}\n\nRules:\n- characterAssetIds and sceneryAssetIds must be arrays of IDs from the asset plan.\n- sceneDescription should explain actions, camera, and mood while preserving visual consistency from styleAnchor.\n\nReturn shape:\n{\n  \"pageNumber\": number,\n  \"sceneDescription\": string,\n  \"characterAssetIds\": string[],\n  \"sceneryAssetIds\": string[]\n}`
  });

  return CONTINUITY_SCENE_SCHEMA.parse(parseJsonFromModel(content));
}

function resolveNanoBananaConfig() {
  const url = process.env.NANO_BANANA_API_URL?.trim();
  if (!url) return null;

  return {
    url,
    apiKey: process.env.NANO_BANANA_API_KEY?.trim() || null
  };
}

function toDataUriFromPngBase64(base64Data) {
  return `data:image/png;base64,${base64Data}`;
}

async function callNanoBanana({ mode, payload }) {
  const config = resolveNanoBananaConfig();
  if (!config) {
    throw new Error("NANO_BANANA_API_URL is not set");
  }

  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode, ...payload })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Nano Banana API failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function generateContinuityAsset(asset, type, styleAnchor, assetsDir) {
  const assetFileName = `${asset.id}.png`;
  const outputPath = path.join(assetsDir, assetFileName);

  const json = await withRetry(
    () =>
      callNanoBanana({
        mode: "generate_asset",
        payload: {
          assetType: type,
          assetId: asset.id,
          name: asset.name,
          description: asset.visualDescription,
          styleAnchor,
          outputFormat: "png"
        }
      }),
    { name: `Nano Banana asset ${asset.id}` }
  );

  const base64 = json?.imageBase64;
  if (!base64) {
    throw new Error(`Nano Banana asset response missing imageBase64 for ${asset.id}`);
  }

  await writeFile(outputPath, Buffer.from(base64, "base64"));
  return {
    ...asset,
    assetType: type,
    imagePath: outputPath,
    imageDataUri: toDataUriFromPngBase64(base64)
  };
}

async function generateImageWithStableDiffusion(prompt, outputPath) {
  const url = process.env.SD_API_URL ?? "http://127.0.0.1:7860/sdapi/v1/txt2img";
  const steps = Number(process.env.SD_STEPS ?? "30");
  const width = Number(process.env.SD_WIDTH ?? "768");
  const height = Number(process.env.SD_HEIGHT ?? "768");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      steps,
      width,
      height,
      sampler_name: "DPM++ 2M Karras",
      negative_prompt: "text, words, letters, logo, watermark, scary, gore"
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stable Diffusion API failed (${response.status}): ${body}`);
  }

  const json = await response.json();
  const base64 = json?.images?.[0];
  if (!base64) {
    throw new Error("Stable Diffusion API returned no images");
  }

  const buffer = Buffer.from(base64, "base64");
  await writeFile(outputPath, buffer);
  return outputPath;
}

async function generateImageFromContinuityAssets({ scenePlan, assetMap, outputPath, fallbackPrompt }) {
  const characterAssets = scenePlan.characterAssetIds.map((id) => assetMap.get(id)).filter(Boolean);
  const sceneryAssets = scenePlan.sceneryAssetIds.map((id) => assetMap.get(id)).filter(Boolean);

  try {
    const json = await withRetry(
      () =>
        callNanoBanana({
          mode: "compose_scene",
          payload: {
            pageNumber: scenePlan.pageNumber,
            sceneDescription: scenePlan.sceneDescription,
            characterAssets: characterAssets.map((asset) => ({
              id: asset.id,
              name: asset.name,
              image: asset.imageDataUri
            })),
            sceneryAssets: sceneryAssets.map((asset) => ({
              id: asset.id,
              name: asset.name,
              image: asset.imageDataUri
            })),
            outputFormat: "png"
          }
        }),
      { name: `Nano Banana scene page ${scenePlan.pageNumber}` }
    );

    const base64 = json?.imageBase64;
    if (!base64) {
      throw new Error("Nano Banana scene response missing imageBase64");
    }

    await writeFile(outputPath, Buffer.from(base64, "base64"));
    return { imagePath: outputPath, renderer: "nano-banana" };
  } catch (error) {
    console.warn(`Nano Banana compose failed for page ${scenePlan.pageNumber}. Falling back to Stable Diffusion.`, error.message);
    await generateImageWithStableDiffusion(fallbackPrompt, outputPath);
    return { imagePath: outputPath, renderer: "stable-diffusion-fallback", fallbackReason: error.message };
  }
}

async function buildEbook({ title, author, pages, outputFile }) {
  const content = pages.map((page) => ({
    title: `Page ${page.pageNumber}: ${page.label}`,
    data: `<div style=\"text-align:center\"><img src=\"${page.imagePath}\" alt=\"${page.label}\" style=\"max-width:100%;height:auto;\"/></div><p>${escapeHtml(page.text)}</p>`
  }));

  const options = {
    title,
    author,
    content,
    output: outputFile,
    appendChapterTitles: false
  };

  await new Epub(options).promise;
}

function escapeHtml(input) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outDir, { recursive: true });
  const imagesDir = path.join(args.outDir, "images");
  const assetsDir = path.join(args.outDir, "assets");
  await mkdir(imagesDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });

  console.log("1) Generating concept...");
  const concept = await generateConcept(args.prompt);
  concept.title = args.title || concept.title;

  console.log("2) Planning pages...");
  const beats = await planPages(concept, args.pages);

  console.log("3) Writing page text...");
  const storyPages = await writePages(concept, beats);

  console.log("4) Planning reusable continuity assets...");
  const continuityAssetPlan = await planContinuityAssets({ concept, beats, storyPages });

  console.log("5) Generating continuity asset images...");
  const generatedCharacters = await Promise.all(
    continuityAssetPlan.characters.map((asset) => generateContinuityAsset(asset, "character", continuityAssetPlan.styleAnchor, assetsDir))
  );
  const generatedScenery = await Promise.all(
    continuityAssetPlan.scenery.map((asset) => generateContinuityAsset(asset, "scenery", continuityAssetPlan.styleAnchor, assetsDir))
  );

  const assetMap = new Map([...generatedCharacters, ...generatedScenery].map((asset) => [asset.id, asset]));

  const assembled = [];
  console.log("6) Building page scenes from reusable assets...");
  for (const page of storyPages.sort((a, b) => a.pageNumber - b.pageNumber)) {
    const imagePrompt = await makeImagePrompt(page);
    const scenePlan = await planPageContinuityScene({ page, assetPlan: continuityAssetPlan });
    const imagePath = path.join(imagesDir, `page-${String(page.pageNumber).padStart(2, "0")}.png`);

    const renderResult = await generateImageFromContinuityAssets({
      scenePlan,
      assetMap,
      outputPath: imagePath,
      fallbackPrompt: imagePrompt
    });

    const bundle = {
      ...page,
      imagePrompt,
      imagePath: renderResult.imagePath,
      renderer: renderResult.renderer,
      fallbackReason: renderResult.fallbackReason ?? null,
      scenePlan
    };

    assembled.push(bundle);
    await writeFile(path.join(args.outDir, `page-${String(page.pageNumber).padStart(2, "0")}.json`), JSON.stringify(bundle, null, 2));
  }

  console.log("7) Building ebook...");
  const ebookPath = path.join(args.outDir, `${slugify(args.title)}.epub`);
  await buildEbook({
    title: args.title,
    author: args.author,
    pages: assembled,
    outputFile: ebookPath
  });

  const continuityAssetManifest = {
    styleAnchor: continuityAssetPlan.styleAnchor,
    characters: generatedCharacters.map(({ imageDataUri, ...rest }) => rest),
    scenery: generatedScenery.map(({ imageDataUri, ...rest }) => rest)
  };

  await writeFile(path.join(args.outDir, "concept.json"), JSON.stringify(concept, null, 2));
  await writeFile(path.join(args.outDir, "plan.json"), JSON.stringify(beats, null, 2));
  await writeFile(path.join(args.outDir, "continuity-assets.json"), JSON.stringify(continuityAssetManifest, null, 2));
  await writeFile(path.join(args.outDir, "book.json"), JSON.stringify(assembled, null, 2));

  console.log(`Done. EPUB written to: ${ebookPath}`);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

main().catch((error) => {
  console.error("Book generation failed:", error.message);
  process.exit(1);
});
