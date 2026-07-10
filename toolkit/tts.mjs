#!/usr/bin/env node
// Narration TTS: text -> mp3 file. Two providers, one seam:
//   yunwu  (default) — MiniMax speech-2.8-hd. The voice used for the gugu promo film
//                      was voice_id "Chinese (Mandarin)_Reliable_Executive" @ speed 1.18.
//   grok           — OpenRouter grok-voice-tts-1.0.
// Usage: node tts.mjs --text "line" --out narration/01.mp3 [--provider yunwu|grok] [--voice <id>] [--speed 1.18]
//        node tts.mjs --lines lines.json --outdir narration/    (batch: [{id,text,voice?,speed?}])
//
// Keys come from the ENVIRONMENT ONLY (fail loud if missing — never bake keys into the repo):
//   YUNWU_API_KEY        for the yunwu provider
//   OPENROUTER_API_KEY   for the grok provider
// Swap in your own provider by editing synth() — the rest of the pipeline only depends on
// "id -> id.mp3" landing in --outdir.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'

const OR_URL = 'https://openrouter.ai/api/v1/audio/speech'
const OR_MODEL = process.env.VOICE_TTS_MODEL ?? 'x-ai/grok-voice-tts-1.0'
const YUNWU_URL = process.env.YUNWU_TTS_URL ?? 'https://yunwu.ai/minimax/v1/t2a_v2'

function requireEnv(name) {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`${name} is not set — export it before running (keys never live in this repo).`)
  return v
}
const grokKey = () => requireEnv('OPENROUTER_API_KEY')
const yunwuKey = () => requireEnv('YUNWU_API_KEY')

async function synthGrok(text, voice) {
  const res = await fetch(OR_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await grokKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost/promo-skills',
      'X-Title': 'promo-skills TTS',
    },
    body: JSON.stringify({ model: OR_MODEL, input: text, voice: voice ?? 'Eve', response_format: 'mp3' }),
  })
  if (!res.ok) throw new Error(`grok TTS ${res.status} ${res.statusText}: ${await res.text().catch(() => '')}`)
  return Buffer.from(await res.arrayBuffer())
}

async function synthYunwu(text, voice, speed) {
  // Gotcha (measured): MiniMax reads multi-line text with audible stutter at line breaks.
  // Flatten newlines to a comma so one caption = one smooth breath.
  const flat = text.replace(/\s*\n\s*/g, '，')
  const res = await fetch(YUNWU_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await yunwuKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'speech-2.8-hd',
      text: flat,
      stream: false,
      language_boost: 'Chinese',
      output_format: 'hex',
      voice_setting: {
        voice_id: voice ?? 'Chinese (Mandarin)_Reliable_Executive',
        speed: speed ?? 1.18,
        vol: 1,
        pitch: 0,
      },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.base_resp?.status_code !== 0 || !body.data?.audio) {
    throw new Error(`yunwu TTS 失败: http ${res.status}, base_resp=${JSON.stringify(body?.base_resp)}`)
  }
  return Buffer.from(body.data.audio, 'hex')
}

async function synth(text, voice, provider, speed) {
  return provider === 'grok' ? synthGrok(text, voice) : synthYunwu(text, voice, speed)
}

const args = process.argv.slice(2)
const get = (k) => {
  const i = args.indexOf('--' + k)
  return i >= 0 ? args[i + 1] : undefined
}

const provider = get('provider') ?? 'yunwu'
const speed = get('speed') ? Number(get('speed')) : undefined

if (get('text')) {
  const out = get('out') ?? 'out.mp3'
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, await synth(get('text'), get('voice'), provider, speed))
  console.log(out)
} else if (get('lines')) {
  const lines = JSON.parse(await readFile(get('lines'), 'utf8'))
  const outdir = get('outdir') ?? '.'
  await mkdir(outdir, { recursive: true })
  for (const l of lines) {
    const out = join(outdir, `${l.id}.mp3`)
    await writeFile(out, await synth(l.text, l.voice ?? get('voice'), provider, l.speed ?? speed))
    console.log(out)
  }
} else {
  console.error('usage: tts.mjs --text "..." --out f.mp3 | --lines lines.json --outdir dir  [--provider yunwu|grok]')
  process.exit(1)
}
