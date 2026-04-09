# Childrens-book-agent

AI Children’s Book Creator Agent is a JavaScript + Bun pipeline that:

1. Generates a **book concept** from a text prompt using a llama.cpp-compatible API.
2. Converts the concept into a **page-by-page beat list**.
3. Writes each page’s story text.
4. Plans reusable **continuity assets** (character sheets + scenery anchors).
5. Uses the **Google Nano Banana API** (if configured) to generate assets and compose each page scene by reusing those assets.
6. Falls back to Stable Diffusion if scene composition fails for any page.
7. Combines text + images in order and exports an **EPUB e-book**.

## Requirements

- [Bun](https://bun.sh)
- A running llama.cpp server with OpenAI-compatible `/v1/chat/completions`
- A Google Nano Banana image endpoint (recommended for continuity)
- Optional fallback Stable Diffusion endpoint (e.g., AUTOMATIC1111 `/sdapi/v1/txt2img`)

## Install

```bash
bun install
```

## Configure APIs

```bash
export LLAMA_API_URL="http://127.0.0.1:8080/v1/chat/completions"
export LLAMA_MODEL="local-model"

# Optional but recommended continuity renderer
export NANO_BANANA_API_URL="https://your-nano-banana-endpoint.example/v1/images"
export NANO_BANANA_API_KEY="your-token"

# Optional fallback renderer if Nano Banana scene composition fails
export SD_API_URL="http://127.0.0.1:7860/sdapi/v1/txt2img"
export SD_STEPS="30"
export SD_WIDTH="768"
export SD_HEIGHT="768"
```

## Run

```bash
bun run src/index.js \
  --prompt "A shy dragon learns to sing and helps a town feel brave" \
  --title "Luma Finds Her Song" \
  --author "AI Story Studio" \
  --pages 10 \
  --out output
```

## Output

The `output/` folder will contain:

- `concept.json` - generated concept metadata
- `plan.json` - page beat plan
- `continuity-assets.json` - reusable generated character/scenery asset manifest
- `assets/*.png` - rendered reusable character/scenery assets
- `page-XX.json` - each page’s text + scene composition + image metadata
- `book.json` - full assembled book payload
- `images/page-XX.png` - generated page illustrations
- `<title>.epub` - final e-book

## Continuity behavior

- The pipeline first creates reusable character and scenery assets from story context.
- Each page is then composed from those assets in new scenes (different actions/places), preserving visual continuity.
- If the Nano Banana scene composition call fails for a page, the page is rendered via Stable Diffusion using a generated fallback prompt.

## Notes

- The script validates intermediate model JSON with `zod`.
- If llama.cpp returns text around JSON, ensure your model follows structured output instructions.
- Nano Banana response handling expects `{ imageBase64: "..." }` payloads for both asset generation and scene composition.
