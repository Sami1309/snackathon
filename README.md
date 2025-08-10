# Prompt → Remotion (One‑Page App + Backend)

This repo includes:
- A backend (`server.js`) that proxies prompts to OpenAI (defaults to `gpt-5`) and returns a Remotion project (TypeScript/React).
- A single‑page app in `web/` with a live Remotion Player that previews the generated code and shows a progress bar.

If you opened a URL and saw nothing, make sure you are using the Vite dev server URL during development: `http://localhost:5173`.

## Quick Start (Dev)

- Prerequisites: Node.js 18+
- Set key (real API): `export OPENAI_API_KEY=sk-...`
- Start backend on port 3003:
  - `PORT=3003 node server.js`
- Start the web app (Vite dev server on 5173):
  - `cd web && npm install && npm run dev`
- Open the app: `http://localhost:5173`
- In the app, uncheck “Use mock backend”, write a prompt, click “Generate Remotion Project”. The right panel previews it live.

Troubleshooting blank page
- Open the correct URL: `http://localhost:5173` (dev server). The Node server at `http://localhost:3003` only serves the built app (`web/dist`) after you run `npm run build`.
- Check backend health: `curl http://localhost:3003/api/health` — ensure `hasKey: true` when using the real API.
- Network restrictions: If outbound calls are blocked, use mock mode in the UI, or run `DEV_FALLBACK=1 PORT=3003 node server.js` so the backend returns a local example.
- Logs: `tail -f server.log` and `tail -f web/vite.log` if you started them in the background.

## Production (Serve the built SPA from Node)

- Build the web app: `cd web && npm install && npm run build`
- Start the backend: `PORT=3003 node server.js`
- Open: `http://localhost:3003` (server serves `web/dist` if present)

## API

- `POST /api/generate`
  - Body: `{ "prompt": "..." }`
  - Returns a Remotion project JSON with fields:
    - `kind: "remotion-project"`
    - `files`: Map like `{ "src/index.ts": string, "src/Root.tsx": string, "src/MyComp.tsx": string, ... }`
    - `compositionId`, `fps`, `durationInFrames`, `width`, `height`

- `GET /api/health`
  - Returns `{ ok: true, model, hasKey }`

## Environment Variables

- `OPENAI_API_KEY`: Required for real OpenAI calls.
- `OPENAI_MODEL`: Defaults to `gpt-5`. You may override per request by sending `{ model }` in the body.
- `PORT`: Defaults to `3000` (we use `3003` in examples).
- `HOST`: Defaults to `0.0.0.0`.
- `DEV_FALLBACK`: If `1`/`true`/`on`, `/api/generate` returns a local example when upstream fails.

## Notes

- The backend is dependency‑free (Node 18+ only) and serves `/api/*` plus static files (prefers `web/dist` if present).
- The web app uses Remotion Player to preview the generated `src/MyComp.tsx` live, and can download a ZIP of the `src/` files.
