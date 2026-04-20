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

const CONCEPT_SCHEMA = z.object({
  title: z.string().min(3),
  audience: z.string().min(2),
  coreLesson: z.string().min(5),
  setting: z.string().min(3),
  characters: z.array(z.string().min(2)).min(1)
});

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

const STORY_BIBLE_SCHEMA = z.object({
  styleGuide: z.string().min(20),
  characterContinuity: z.array(
    z.object({
      name: z.string().min(2),
      visualTraits: z.array(z.string().min(2)).min(1),
      emotionalArc: z.string().min(10)
    })
  ),
  settingContinuity: z.array(z.string().min(5)).min(1),
  bannedVisualElements: z.array(z.string().min(2)).min(1)
});

const SCENE_BRIEF_SCHEMA = z.object({
  pageNumber: z.number().int().positive(),
  visualSummary: z.string().min(20),
  continuityChecklist: z.array(z.string().min(5)).min(2),
  cameraAndComposition: z.string().min(10),
  lightingAndPalette: z.string().min(10)
});

function parseArgs(argv) {
  const args = {
    prompt: "",
    ideaSeed: "",
    autoIdeas: false,
    maxBooks: null,
    maxMinutes: null,
    title: "My AI Storybook",
    author: "Children's Book Agent",
    pages: 10,
    outDir: "output",
    llmProvider: process.env.LLM_PROVIDER ?? "llama"
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }

    if (token === "--prompt") args.prompt = argv[++i] ?? "";
    else if (token === "--idea-seed") args.ideaSeed = argv[++i] ?? "";
    else if (token === "--auto-ideas") args.autoIdeas = true;
    else if (token === "--max-books") args.maxBooks = Number(argv[++i]);
    else if (token === "--max-minutes") args.maxMinutes = Number(argv[++i]);
    else if (token === "--title") args.title = argv[++i] ?? args.title;
    else if (token === "--author") args.author = argv[++i] ?? args.author;
    else if (token === "--pages") args.pages = Number(argv[++i] ?? args.pages);
    else if (token === "--out") args.outDir = argv[++i] ?? args.outDir;
    else if (token === "--llm-provider") args.llmProvider = argv[++i] ?? args.llmProvider;
  }

  if (!args.autoIdeas && !args.prompt.trim()) {
    throw new Error("Missing --prompt (or use --auto-ideas). Use --help for usage.");
  }

  if (args.maxBooks != null && (!Number.isInteger(args.maxBooks) || args.maxBooks <= 0)) {
    throw new Error("--max-books must be a positive integer.");
  }

  if (args.maxMinutes != null && (!Number.isFinite(args.maxMinutes) || args.maxMinutes <= 0)) {
    throw new Error("--max-minutes must be a positive number.");
  }

  if (args.autoIdeas && args.maxBooks == null && args.maxMinutes == null) {
    throw new Error("--auto-ideas requires at least one stop limit: --max-books or --max-minutes.");
  }

  return args;
}

function printHelp() {
  console.log(`\nChildren's Book Agent (Bun + JavaScript)\n\nUsage:\n  bun run src/index.js --prompt \"A shy dragon learns to sing\" [options]\n  bun run src/index.js --auto-ideas --max-books 3 [options]\n\nOptions:\n  --prompt        <string>   Story seed prompt for a single book\n  --auto-ideas               Generate book ideas automatically (no --prompt needed)\n  --idea-seed     <string>   Optional theme guidance for auto-idea mode\n  --max-books     <number>   Stop after this many auto-generated books\n  --max-minutes   <number>   Stop auto mode after this many minutes\n  --title         <string>   Ebook title (default: My AI Storybook)\n  --author        <string>   Ebook author (default: Children's Book Agent)\n  --pages         <number>   Number of pages to create (default: 10)\n  --out           <path>     Output directory (default: output)\n  --llm-provider  <name>     llama | gpt | gemini | claude | lechat (default: llama)\n  --help                     Show this help\n\nEnvironment:\n  LLM_PROVIDER            Default: llama\n\n  # llama.cpp-compatible (provider: llama)\n  LLAMA_API_URL           Default: http://127.0.0.1:8080/v1/chat/completions\n  LLAMA_MODEL             Default: local-model\n\n  # OpenAI GPT (provider: gpt)\n  OPENAI_API_KEY          Required for gpt provider\n  OPENAI_API_URL          Default: https://api.openai.com/v1/chat/completions\n  OPENAI_MODEL            Default: gpt-4.1-mini\n\n  # Google Gemini (provider: gemini)\n  GEMINI_API_KEY          Required for gemini provider\n  GEMINI_MODEL            Default: gemini-2.0-flash\n\n  # Anthropic Claude (provider: claude)\n  ANTHROPIC_API_KEY       Required for claude provider\n  ANTHROPIC_API_URL       Default: https://api.anthropic.com/v1/messages\n  ANTHROPIC_MODEL         Default: claude-3-7-sonnet-latest\n\n  # Le Chat / Mistral-compatible (provider: lechat)\n  LECHAT_API_KEY          Required for lechat provider\n  LECHAT_API_URL          Default: https://api.mistral.ai/v1/chat/completions\n  LECHAT_MODEL            Default: mistral-large-latest\n\n  # Image generation\n  NANO_BANANA_API_URL     Optional. Endpoint for Google Nano Banana image generation + scene composition\n  NANO_BANANA_API_KEY     Optional auth token sent as Bearer\n  SD_API_URL              Default: http://127.0.0.1:7860/sdapi/v1/txt2img (fallback if Nano Banana fails)\n  SD_STEPS                Default: 30\n  SD_WIDTH                Default: 768\n  SD_HEIGHT               Default: 768\n`);
}

function resolveLlmProvider() {
  const rawProvider = (process.env.LLM_PROVIDER ?? "llama").trim().toLowerCase();
  const allowed = new Set(["llama", "gpt", "gemini", "claude", "lechat"]);
  if (!allowed.has(rawProvider)) {
    throw new Error(`Unsupported LLM provider "${rawProvider}". Use one of: llama, gpt, gemini, claude, lechat.`);
  }
  return rawProvider;
}

function extractOpenAiStyleContent(json, providerName) {
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${providerName} response missing choices[0].message.content`);
  }

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("\n")
      .trim();
  }

  return String(content).trim();
}

async function callLlm({ system, user, temperature = 0.4 }) {
  const provider = resolveLlmProvider();

  if (provider === "llama") {
    const url = process.env.LLAMA_API_URL ?? "http://127.0.0.1:8080/v1/chat/completions";
    const model = process.env.LLAMA_MODEL ?? "local-model";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature,
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
    return extractOpenAiStyleContent(await response.json(), "llama.cpp");
  }

  if (provider === "gpt") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for provider=gpt");
    const url = process.env.OPENAI_API_URL ?? "https://api.openai.com/v1/chat/completions";
    const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API failed (${response.status}): ${body}`);
    }
    return extractOpenAiStyleContent(await response.json(), "OpenAI");
  }

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for provider=gemini");
    const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature }
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini API failed (${response.status}): ${body}`);
    }

    const json = await response.json();
    const parts = json?.candidates?.[0]?.content?.parts;
    const content = Array.isArray(parts) ? parts.map((part) => part?.text ?? "").join("\n").trim() : "";
    if (!content) {
      throw new Error("Gemini API response missing candidates[0].content.parts[].text");
    }
    return content;
  }

  if (provider === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for provider=claude");
    const url = process.env.ANTHROPIC_API_URL ?? "https://api.anthropic.com/v1/messages";
    const model = process.env.ANTHROPIC_MODEL ?? "claude-3-7-sonnet-latest";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature,
        system,
        messages: [{ role: "user", content: user }]
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Claude API failed (${response.status}): ${body}`);
    }
    const json = await response.json();
    const content = json?.content?.find((item) => item?.type === "text")?.text?.trim();
    if (!content) {
      throw new Error("Claude API response missing content text");
    }
    return content;
  }

  const apiKey = process.env.LECHAT_API_KEY?.trim();
  if (!apiKey) throw new Error("LECHAT_API_KEY is required for provider=lechat");
  const url = process.env.LECHAT_API_URL ?? "https://api.mistral.ai/v1/chat/completions";
  const model = process.env.LECHAT_MODEL ?? "mistral-large-latest";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Le Chat API failed (${response.status}): ${body}`);
  }
  return extractOpenAiStyleContent(await response.json(), "Le Chat");
}

function parseJsonFromModel(text) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const startObject = cleaned.indexOf("{");
    const startArray = cleaned.indexOf("[");
    const start = startObject === -1 ? startArray : startArray === -1 ? startObject : Math.min(startObject, startArray);
    const endObject = cleaned.lastIndexOf("}");
    const endArray = cleaned.lastIndexOf("]");
    const end = Math.max(endObject, endArray);
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model output did not contain valid JSON.");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
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
  const content = await callLlm({
    system: "You create short, age-appropriate children's story concepts. Be concrete and internally consistent.",
    user: `Create one children's book concept from this seed:\n${seedPrompt}\n\nReturn JSON only with keys: title, audience, coreLesson, setting, characters.`,
    temperature: 0.5
  });
  return CONCEPT_SCHEMA.parse(parseJsonFromModel(content));
}

async function generateAutonomousIdea(ideaSeed) {
  const content = await callLlm({
    system: "You invent delightful, marketable, age-appropriate children's book ideas.",
    user: `Create one fresh children's picture-book idea. ${ideaSeed ? `Theme guidance: ${ideaSeed}` : "No theme guidance is required."}

Return JSON only with keys:
- prompt: a concise seed prompt that can be fed into a book-generation pipeline
- suggestedTitle: a short title
- suggestedAudience: age range like "4-8"
- rationale: one sentence about why this idea is engaging for children.`,
    temperature: 0.8
  });

  return z
    .object({
      prompt: z.string().min(8),
      suggestedTitle: z.string().min(3),
      suggestedAudience: z.string().min(2),
      rationale: z.string().min(10)
    })
    .parse(parseJsonFromModel(content));
}

async function planPages(concept, pageCount) {
  const content = await callLlm({
    system: "You are a children's book planner focused on tight narrative continuity.",
    user: `Using this concept:\n${JSON.stringify(concept, null, 2)}\n\nCreate exactly ${pageCount} page beats.\nRequirements:\n- page numbers must run 1..${pageCount} with no gaps.\n- labels should be short and specific.\n- each page should move the story forward from the previous page.\nReturn JSON array only. Each item: { pageNumber, label, events: string[] }`,
    temperature: 0.2
  });

  const parsed = parseJsonFromModel(content);
  return PAGE_SCHEMA.parse(parsed);
}

async function repairPagePlan({ concept, pageCount, brokenPlan }) {
  const content = await callLlm({
    system: "You repair children's book page plans. Return valid JSON only.",
    user: `Repair this page plan so it is complete and internally consistent.\n\nConcept:\n${JSON.stringify(concept, null, 2)}\n\nTarget page count: ${pageCount}\n\nBroken plan:\n${JSON.stringify(brokenPlan, null, 2)}\n\nRules:\n- Return exactly ${pageCount} items.\n- Use page numbers 1..${pageCount} exactly once each.\n- Keep labels concise and clear.\n- Keep each events array non-empty and story-progressing.\n- Return JSON array only in this shape: [{ "pageNumber": number, "label": string, "events": string[] }].`,
    temperature: 0.1
  });

  return PAGE_SCHEMA.parse(parseJsonFromModel(content));
}

async function writePages(concept, beats) {
  const content = await callLlm({
    system: "You write warm, simple, vivid storybook pages for kids ages 4-8.",
    user: `Write page text from this concept and plan.\n\nConcept:\n${JSON.stringify(concept, null, 2)}\n\nPlan:\n${JSON.stringify(beats, null, 2)}\n\nRules:\n- Use exactly one entry per plan pageNumber.\n- Use the exact label from the matching plan beat.\n- Keep story continuity across pages (same character names and setting details).\n- Keep each page text to 55-95 words.\n\nReturn JSON array only. Each item: { pageNumber, label, text }.`,
    temperature: 0.35
  });

  const parsed = parseJsonFromModel(content);
  return STORY_PAGE_SCHEMA.parse(parsed);
}

async function repairStoryPages({ concept, beats, brokenPages }) {
  const content = await callLlm({
    system: "You repair children's story page JSON. Return valid JSON only.",
    user: `Repair this page array so it exactly matches the beat plan and keeps age 4-8 language.\n\nConcept:\n${JSON.stringify(concept, null, 2)}\n\nPlan:\n${JSON.stringify(beats, null, 2)}\n\nBroken pages:\n${JSON.stringify(brokenPages, null, 2)}\n\nRules:\n- Keep exactly one entry per page number in the plan.\n- Keep each text 55-95 words.\n- Keep tone warm, concrete, and child-safe.\n- Return JSON array only in this shape: [{ "pageNumber": number, "label": string, "text": string }].`,
    temperature: 0.1
  });

  return STORY_PAGE_SCHEMA.parse(parseJsonFromModel(content));
}

function validateStoryCoverage(storyPages, beats) {
  const expected = new Set(beats.map((beat) => beat.pageNumber));
  const beatByPage = new Map(beats.map((beat) => [beat.pageNumber, beat]));
  const seen = new Set();
  for (const page of storyPages) {
    if (!expected.has(page.pageNumber)) {
      throw new Error(`Story pages included unexpected pageNumber=${page.pageNumber}`);
    }
    if (seen.has(page.pageNumber)) {
      throw new Error(`Story pages included duplicate pageNumber=${page.pageNumber}`);
    }
    const expectedLabel = beatByPage.get(page.pageNumber)?.label;
    if (expectedLabel && page.label.trim() !== expectedLabel.trim()) {
      throw new Error(
        `Story page label mismatch for pageNumber=${page.pageNumber}. Expected "${expectedLabel}", got "${page.label}".`
      );
    }
    seen.add(page.pageNumber);
  }
  if (seen.size !== expected.size) {
    throw new Error(`Story pages count mismatch. Expected ${expected.size}, got ${seen.size}.`);
  }
}

function validatePagePlanCoverage(planPages, pageCount) {
  const seen = new Set();
  for (const page of planPages) {
    if (page.pageNumber < 1 || page.pageNumber > pageCount) {
      throw new Error(`Plan included out-of-range pageNumber=${page.pageNumber}`);
    }
    if (seen.has(page.pageNumber)) {
      throw new Error(`Plan included duplicate pageNumber=${page.pageNumber}`);
    }
    seen.add(page.pageNumber);
  }

  if (seen.size !== pageCount) {
    throw new Error(`Plan page count mismatch. Expected ${pageCount}, got ${seen.size}.`);
  }
}

function alignStoryPageLabelsWithPlan(storyPages, beats) {
  const beatByPage = new Map(beats.map((beat) => [beat.pageNumber, beat]));
  return storyPages.map((page) => ({
    ...page,
    label: beatByPage.get(page.pageNumber)?.label ?? page.label
  }));
}

async function generateStoryBible({ concept, beats, storyPages }) {
  const content = await callLlm({
    system: "You create a continuity bible that keeps picture-book visuals and tone consistent.",
    user: `Return JSON only. Build a compact story bible from this concept, beat plan, and full page text.\n\nConcept:\n${JSON.stringify(concept, null, 2)}\n\nBeats:\n${JSON.stringify(beats, null, 2)}\n\nStory Pages:\n${JSON.stringify(storyPages, null, 2)}\n\nReturn shape:\n{\n  "styleGuide": string,\n  "characterContinuity": [{ "name": string, "visualTraits": string[], "emotionalArc": string }],\n  "settingContinuity": string[],\n  "bannedVisualElements": string[]\n}`
  });

  return STORY_BIBLE_SCHEMA.parse(parseJsonFromModel(content));
}

async function planSceneBrief({ page, previousPage, storyBible }) {
  const content = await callLlm({
    system: "You are a visual director for children's books. Preserve cross-page continuity exactly.",
    user: `Return JSON only. Create a detailed scene brief for one page that references continuity rules.\n\nStory Bible:\n${JSON.stringify(storyBible, null, 2)}\n\nCurrent Page:\n${JSON.stringify(page, null, 2)}\n\nPrevious Page (if any):\n${previousPage ? JSON.stringify(previousPage, null, 2) : "none"}\n\nReturn shape:\n{\n  "pageNumber": number,\n  "visualSummary": string,\n  "continuityChecklist": string[],\n  "cameraAndComposition": string,\n  "lightingAndPalette": string\n}`
  });

  return SCENE_BRIEF_SCHEMA.parse(parseJsonFromModel(content));
}

async function makeImagePromptFromBrief({ page, sceneBrief, storyBible }) {
  const content = await callLlm({
    system: "You convert structured scene briefs into stable diffusion prompts for illustrated children's books.",
    user: `Create one polished image prompt that keeps strict visual continuity and child-safe tone.\n\nPage:\n${JSON.stringify(page, null, 2)}\n\nScene brief:\n${JSON.stringify(sceneBrief, null, 2)}\n\nStory bible:\n${JSON.stringify(storyBible, null, 2)}\n\nRules:\n- Keep style consistent with story bible styleGuide.
- Explicitly include key character traits and setting anchors.
- Include camera and palette instructions.
- Avoid text overlays, logos, and frightening imagery.
- Return plain text only.`
  });

  return content.replace(/^"|"$/g, "").trim();
}

async function planContinuityAssets({ concept, beats, storyPages }) {
  const content = await callLlm({
    system: "You plan reusable visual assets for continuity in children's picture books.",
    user: `You must return JSON only.\nGiven this concept, beat plan, and story pages, create a reusable visual asset plan.\n\nConcept:\n${JSON.stringify(concept, null, 2)}\n\nBeats:\n${JSON.stringify(beats, null, 2)}\n\nStory Pages:\n${JSON.stringify(storyPages, null, 2)}\n\nRules:\n- Create stable IDs in kebab-case.\n- Include recurring main characters and important scenery/backgrounds that should persist across pages.\n- styleAnchor should define one consistent illustration style for the whole book.\n\nReturn shape:\n{\n  \"styleAnchor\": string,\n  \"characters\": [{ \"id\": string, \"name\": string, \"visualDescription\": string }],\n  \"scenery\": [{ \"id\": string, \"name\": string, \"visualDescription\": string }]\n}`
  });

  return CONTINUITY_ASSET_PLAN_SCHEMA.parse(parseJsonFromModel(content));
}

async function planPageContinuityScene({ page, assetPlan }) {
  const content = await callLlm({
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

async function runSingleBook({ prompt, title, author, pages, outDir }) {
  await mkdir(outDir, { recursive: true });
  const imagesDir = path.join(outDir, "images");
  const assetsDir = path.join(outDir, "assets");
  await mkdir(imagesDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });

  console.log("1) Generating concept...");
  const concept = await withRetry(() => generateConcept(prompt), { name: "generate concept" });
  concept.title = title || concept.title;
  const finalTitle = concept.title;

  console.log("2) Planning pages...");
  let beats = await withRetry(() => planPages(concept, pages), { name: "plan pages" });
  try {
    validatePagePlanCoverage(beats, pages);
  } catch (error) {
    console.warn(`Plan validation failed. Repairing plan once... (${error.message})`);
    beats = await withRetry(() => repairPagePlan({ concept, pageCount: pages, brokenPlan: beats }), { name: "repair page plan" });
    validatePagePlanCoverage(beats, pages);
  }

  console.log("3) Writing page text...");
  let storyPages = await withRetry(() => writePages(concept, beats), { name: "write pages" });
  storyPages = alignStoryPageLabelsWithPlan(storyPages, beats);
  try {
    validateStoryCoverage(storyPages, beats);
  } catch (error) {
    console.warn(`Story validation failed. Repairing pages once... (${error.message})`);
    storyPages = await withRetry(() => repairStoryPages({ concept, beats, brokenPages: storyPages }), { name: "repair pages" });
    storyPages = alignStoryPageLabelsWithPlan(storyPages, beats);
    validateStoryCoverage(storyPages, beats);
  }

  let continuityAssetPlan = null;
  let storyBible = null;
  let generatedCharacters = [];
  let generatedScenery = [];
  let assetMap = new Map();
  const nanoBananaEnabled = Boolean(resolveNanoBananaConfig());

  console.log("4) Building story bible for continuity and style fidelity...");
  storyBible = await withRetry(
    () => generateStoryBible({ concept, beats, storyPages }),
    { name: "generate story bible" }
  );

  if (nanoBananaEnabled) {
    try {
      console.log("5) Planning reusable continuity assets...");
      continuityAssetPlan = await withRetry(
        () => planContinuityAssets({ concept, beats, storyPages }),
        { name: "plan continuity assets" }
      );

      console.log("6) Generating continuity asset images...");
      generatedCharacters = await Promise.all(
        continuityAssetPlan.characters.map((asset) => generateContinuityAsset(asset, "character", continuityAssetPlan.styleAnchor, assetsDir))
      );
      generatedScenery = await Promise.all(
        continuityAssetPlan.scenery.map((asset) => generateContinuityAsset(asset, "scenery", continuityAssetPlan.styleAnchor, assetsDir))
      );
      assetMap = new Map([...generatedCharacters, ...generatedScenery].map((asset) => [asset.id, asset]));
    } catch (error) {
      console.warn(`Continuity asset workflow failed; falling back to Stable Diffusion-only rendering. ${error.message}`);
      continuityAssetPlan = null;
      generatedCharacters = [];
      generatedScenery = [];
      assetMap = new Map();
    }
  } else {
    console.log("4) NANO_BANANA_API_URL not configured. Using Stable Diffusion-only rendering.");
  }

  const assembled = [];
  console.log("7) Rendering page images with scene refinement...");
  const orderedPages = storyPages.sort((a, b) => a.pageNumber - b.pageNumber);
  for (let index = 0; index < orderedPages.length; index++) {
    const page = orderedPages[index];
    const previousPage = index > 0 ? orderedPages[index - 1] : null;
    const sceneBrief = await withRetry(
      () => planSceneBrief({ page, previousPage, storyBible }),
      { name: `plan scene brief page ${page.pageNumber}` }
    );
    const imagePrompt = await withRetry(
      () => makeImagePromptFromBrief({ page, sceneBrief, storyBible }),
      { name: `build image prompt page ${page.pageNumber}` }
    );
    const imagePath = path.join(imagesDir, `page-${String(page.pageNumber).padStart(2, "0")}.png`);
    let renderResult;
    let scenePlan = null;
    if (continuityAssetPlan) {
      scenePlan = await withRetry(
        () => planPageContinuityScene({ page, assetPlan: continuityAssetPlan }),
        { name: `plan continuity scene page ${page.pageNumber}` }
      );
      renderResult = await generateImageFromContinuityAssets({
        scenePlan,
        assetMap,
        outputPath: imagePath,
        fallbackPrompt: imagePrompt
      });
    } else {
      await generateImageWithStableDiffusion(imagePrompt, imagePath);
      renderResult = { imagePath, renderer: "stable-diffusion" };
    }

    const bundle = {
      ...page,
      imagePrompt,
      imagePath: renderResult.imagePath,
      renderer: renderResult.renderer,
      fallbackReason: renderResult.fallbackReason ?? null,
      scenePlan,
      sceneBrief
    };

    assembled.push(bundle);
    await writeFile(path.join(outDir, `page-${String(page.pageNumber).padStart(2, "0")}.json`), JSON.stringify(bundle, null, 2));
  }

  console.log("8) Building ebook...");
  const ebookPath = path.join(outDir, `${slugify(finalTitle)}.epub`);
  await buildEbook({
    title: finalTitle,
    author,
    pages: assembled,
    outputFile: ebookPath
  });

  const continuityAssetManifest = {
    styleAnchor: continuityAssetPlan?.styleAnchor ?? null,
    characters: generatedCharacters.map(({ imageDataUri, ...rest }) => rest),
    scenery: generatedScenery.map(({ imageDataUri, ...rest }) => rest),
    mode: continuityAssetPlan ? "nano-banana-continuity" : "stable-diffusion-only"
  };

  await writeFile(path.join(outDir, "concept.json"), JSON.stringify(concept, null, 2));
  await writeFile(path.join(outDir, "plan.json"), JSON.stringify(beats, null, 2));
  await writeFile(path.join(outDir, "story-bible.json"), JSON.stringify(storyBible, null, 2));
  await writeFile(path.join(outDir, "continuity-assets.json"), JSON.stringify(continuityAssetManifest, null, 2));
  await writeFile(path.join(outDir, "book.json"), JSON.stringify(assembled, null, 2));

  console.log(`Done. EPUB written to: ${ebookPath}`);
  return { ebookPath, concept };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.env.LLM_PROVIDER = args.llmProvider;

  if (!args.autoIdeas) {
    await runSingleBook({
      prompt: args.prompt,
      title: args.title,
      author: args.author,
      pages: args.pages,
      outDir: args.outDir
    });
    return;
  }

  const deadline = args.maxMinutes == null ? null : Date.now() + args.maxMinutes * 60 * 1000;
  let created = 0;
  console.log("Auto-idea mode started.");

  while (true) {
    if (args.maxBooks != null && created >= args.maxBooks) {
      console.log(`Stopping auto-idea mode: reached --max-books=${args.maxBooks}.`);
      break;
    }
    if (deadline != null && Date.now() >= deadline) {
      console.log(`Stopping auto-idea mode: reached --max-minutes=${args.maxMinutes}.`);
      break;
    }

    const idea = await withRetry(() => generateAutonomousIdea(args.ideaSeed), { name: "generate autonomous idea" });
    const bookIndex = created + 1;
    const bookTitle = idea.suggestedTitle;
    const bookDir = path.join(args.outDir, `book-${String(bookIndex).padStart(3, "0")}-${slugify(bookTitle) || "untitled"}`);

    console.log(`\n=== Auto book ${bookIndex} ===`);
    console.log(`Idea prompt: ${idea.prompt}`);
    console.log(`Rationale: ${idea.rationale}`);
    await runSingleBook({
      prompt: idea.prompt,
      title: bookTitle,
      author: args.author,
      pages: args.pages,
      outDir: bookDir
    });
    await writeFile(path.join(bookDir, "idea.json"), JSON.stringify(idea, null, 2));
    created += 1;
  }

  console.log(`Auto-idea mode paused after creating ${created} book(s).`);
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
