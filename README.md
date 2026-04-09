# Childrens-book-agent

AI Children’s Book Creator Agent is a JavaScript + Bun pipeline that:

1. Generates a **book concept** from a text prompt using a llama.cpp-compatible API.
2. Converts the concept into a **page-by-page beat list**.
3. Writes each page’s story text.
4. Converts each page into a **Stable Diffusion image prompt**.
5. Calls a Stable Diffusion API to render page images.
6. Combines text + images in order and exports an **EPUB e-book**.

## Requirements

- [Bun](https://bun.sh)
- A running llama.cpp server with OpenAI-compatible `/v1/chat/completions`
- A running Stable Diffusion API endpoint (e.g., AUTOMATIC1111 `/sdapi/v1/txt2img`)

## Install

```bash
bun install
```

## Configure APIs

```bash
export LLAMA_API_URL="http://127.0.0.1:8080/v1/chat/completions"
export LLAMA_MODEL="local-model"
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
- `page-XX.json` - each page’s text + image prompt + image path
- `book.json` - full assembled book payload
- `images/page-XX.png` - generated illustrations
- `<title>.epub` - final e-book

## Notes

- The script validates intermediate model JSON with `zod`.
- If llama.cpp returns text around JSON, ensure your model follows structured output instructions.
- If Stable Diffusion returns no images, verify endpoint path and model availability.
