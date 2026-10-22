# toolkit — the runnable tools

Product-agnostic tools for the [promo-video skill](../SKILL.md). Product-specific seams are
marked in-file. Keys come from the **environment only** — nothing here bakes in a credential.

## Install

Copy the toolkit into the film's own folder and install there — `fragments/`, `renders/` and `review/` sit beside it,
and every script finds them as `toolkit/..`:

```bash
cp -r <this skill>/toolkit <film>/toolkit && cd <film>/toolkit
npm install                                 # review-server, ingest, orchestration adapter deps
(cd renderer && npm install)                # Remotion renderer (heavier)
# capture needs Playwright on your capture machine:
npm i -D @playwright/test && npx playwright install chromium
```

## What's here

| Path | What | Run |
|---|---|---|
| `review-server.mjs` | Zero-dep LAN review board (flicker-free, per-artifact URL, `feedback.jsonl` loop). | `PROMO_TITLE=myapp PORT=7799 node review-server.mjs` |
| `tts.mjs` | Narration TTS → mp3. Providers `yunwu` (MiniMax) / `grok` (OpenRouter); swap in `synth()`. | `node tts.mjs --lines lines.json --outdir narration/` |
| `ingest.mjs` | Packages `fragments/<id>/` into `renderer/`'s typed manifest (multi-camera split, path rewrite). | `node ingest.mjs` |
| `capture/recorder-shotloop.ts` | CDP `Page.captureScreenshot` pull-loop recorder — HD at **real 2×**. | imported by your Playwright shoot script |
| `capture/promo-assemble.mjs` | `frames/` + epoch timestamps → CFR mp4 + rebased `events.json`. | `node capture/promo-assemble.mjs <actDir> --name actN` |
| `orchestration/run.gugu-example.mjs` | **Reference adapter** (gugu/Supabase): screenplay JSON → phased service-role writes. Reimplement for your backend. | `node run.gugu-example.mjs screenplay.json --phase prepare --state state.json` |
| `orchestration/screenplay.example.json` | A real screenplay input (cast / friendships / groups / presence / history / timeline). | — |
| `renderer/` | Remotion skeleton: `lib/` (camera, edit, types), `final/` (cutlist, FinalCut, CTA), `NarrationOverlay`, `ZoomFollow`, QA. | `npm run dev` / `npm run render` / `npm run qa` |

## Environment variables

| Var | Used by | Notes |
|---|---|---|
| `YUNWU_API_KEY` | `tts.mjs` (yunwu) | required for that provider; fail-loud if missing |
| `OPENROUTER_API_KEY` | `tts.mjs` (grok) | required for that provider |
| `VOICE_TTS_MODEL` | `tts.mjs` (grok) | override the model id |
| `PROMO_TITLE`, `PORT` | `review-server.mjs` | UI title + bind port (bind to LAN so collaborators can watch) |
| `PROMO_FFMPEG` | `capture/promo-assemble.mjs` | the ffmpeg binary; default: `ffmpeg` on PATH |
| `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | orchestration reference | **your backend's** admin creds — env/`.env.local` only |

## The adapter you must write

`orchestration/run.gugu-example.mjs` is the one product-specific piece. The **phase model**
(`prepare` → `perform` → `teardown`) and the **screenplay JSON schema** are reusable; the actual
database writes are gugu's. Reimplement the phase bodies against your backend so your app's
realtime layer pushes realistic live state to the recorded UI. See
[`../references/orchestration-harness.md`](../references/orchestration-harness.md).

Everything else — capture recorder, assembler, camera/edit/types, cutlist/FinalCut, review board,
TTS, QA — runs as-is against any product's screen recordings.
