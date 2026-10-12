// 片场 voice: narration spoken with the person's voice model (OpenRouter, their key), laid on a film at the second each
// line starts. The fit check and the advice are plain functions; speaking and laying are ffmpeg and one fetch each.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CLOCKS, parseLoudness, step } from './clip.js'
import { VOICES, VOICE_MODEL } from './settings.js'

/**
 * How long a voice call waits for the service to price what it bought (its record comes ~12 s later), and how long the
 * next call spends catching up on what was not priced; tests shorten them. Here, not in tools.js: every export of
 * tools.js is a tool, and an object that is not one keeps the whole program from starting.
 */
export const PRICING = { wait: 20_000, catchUp: 8_000 }

/** Narration is brought to this integrated loudness (EBU R128), the level the films on the first table were judged at. */
export const TARGET_LUFS = -16

/** Characters that take time to say: every letter and digit and every Han character; spaces and punctuation do not count. */
export const spokenLength = (text) => [...String(text)].filter((c) => /[\p{L}\p{N}]/u.test(c)).length

/**
 * Lines that do not fit: each must end before the next one starts, and the last before the film ends. For each, by how
 * much it runs over and about how many characters would fit at the pace it was actually spoken.
 */
export function overruns(lines, filmSeconds) {
  return lines.flatMap((line, i) => {
    const room = (i + 1 < lines.length ? lines[i + 1].at : filmSeconds) - line.at
    const over = line.seconds - room
    if (over <= 0) return []
    const chars = spokenLength(line.text)
    const last = i + 1 === lines.length
    return [{ n: i + 1, last, text: line.text, seconds: line.seconds, room: Math.max(room, 0), over, chars, fit: Math.max(1, Math.floor((chars * Math.max(room, 0)) / line.seconds)) }]
  })
}

/** What the agent is told of the lines that did not fit: which, by how much, and about how many characters to cut to. */
export function overrunMessage(problems) {
  const r = (n) => Math.round(n * 10) / 10
  return problems
    .map((p) => {
      const shown = p.text.length > 24 ? `${p.text.slice(0, 24)}…` : p.text
      const next = p.last ? 'the film ends' : `line ${p.n + 1} starts`
      const or = p.last ? 'or start it earlier' : `or start line ${p.n + 1} later`
      return `line ${p.n} (「${shown}」) lasts ${r(p.seconds)} s but has ${r(p.room)} s before ${next} — ${r(p.over)} s over: cut it to about ${p.fit} characters (it has ${p.chars}), ${or}`
    })
    .join('; ')
}

/** Lines in the order they are spoken, each with a start inside the film. */
export function linesOf(lines, filmSeconds) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('lines: the narration, each line as { text, at } (at = the second it starts)')
  const out = lines.map((line, i) => {
    const text = String(line?.text ?? '').trim()
    const at = Number(line?.at)
    if (!text) throw new Error(`line ${i + 1} has no text`)
    if (!Number.isFinite(at) || at < 0 || at >= filmSeconds) throw new Error(`line ${i + 1} starts at ${line?.at}: give the second it starts, from 0 to before the film ends (${Math.round(filmSeconds * 10) / 10} s)`)
    return { text, at }
  })
  for (let i = 1; i < out.length; i += 1) if (out[i].at <= out[i - 1].at) throw new Error(`line ${i + 1} starts at ${out[i].at} s, not after line ${i} (${out[i - 1].at} s): give the lines in the order they are spoken`)
  return out
}

/**
 * One line spoken, as an mp3 file. The same text in the same voice and model is bought once: a retry after a refusal
 * pays only for the lines that changed. Answers the file, and the generation id of a new purchase (null from the cache).
 */
export async function speak({ key, model = VOICE_MODEL, voice, text, cacheDir, tools }) {
  const name = createHash('sha256').update(JSON.stringify([model, voice, text])).digest('hex').slice(0, 32)
  mkdirSync(cacheDir, { recursive: true })
  const file = path.join(cacheDir, `${name}.mp3`)
  if (existsSync(file)) return { file, generation: null }
  const res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    // The text goes in the body as JSON — never on a command line, where Chinese came out garbled (10-12, eight calls lost).
    body: JSON.stringify({ model, input: text, voice: voice.charAt(0).toUpperCase() + voice.slice(1), response_format: 'mp3' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const why = res.status === 402 ? "the person's OpenRouter account is out of credits" : `the voice service said HTTP ${res.status}: ${body.slice(0, 300)}`
    throw new Error(`No voice: ${why}.`)
  }
  // Kept only once it is a sound: a 200 carrying an error in JSON would otherwise be "the line" for good — an agent
  // cannot clear the cache, and every retry would lay the same nothing.
  const type = res.headers.get('content-type') ?? ''
  const bytes = Buffer.from(await res.arrayBuffer())
  if (!type.startsWith('audio/')) throw new Error(`No voice: the voice service answered ${type || 'with no type'}, not a sound: ${bytes.toString('utf8', 0, 200)}`)
  const part = `${file}.part`
  writeFileSync(part, bytes)
  try {
    if (!(await secondsOf(tools, part) > 0)) throw new Error('it has no length')
  } catch (error) {
    rmSync(part, { force: true })
    throw new Error(`No voice: what the voice service sent cannot be played (${error.message}) — try again`)
  }
  renameSync(part, file)
  return { file, generation: res.headers.get('x-generation-id') }
}

/**
 * What a purchase cost, as OpenRouter's own record of it says. A speech purchase's record appears some 12 s after it
 * (measured 10-12): this asks again until `deadline` (callers price all of a call's purchases at once, against one
 * deadline), each ask on a clock of its own (`each`), so a service that hangs costs the deadline and no more. A key that
 * brings its own provider key (BYOK) is charged upstream: that cost is the one that counts. null: not priced in time.
 */
export async function costOf(key, generation, { deadline = Date.now() + 20_000, each = 5_000, wait = 800 } = {}) {
  if (!generation) return 0
  while (Date.now() < deadline) {
    const clock = AbortSignal.timeout(Math.max(1, Math.min(each, deadline - Date.now())))
    try {
      const res = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generation)}`, { headers: { Authorization: `Bearer ${key}` }, signal: clock })
      if (res.ok) {
        const record = (await res.json()).data ?? {}
        const usd = record.is_byok ? Number(record.upstream_inference_cost) || Number(record.total_cost) : Number(record.total_cost)
        if (Number.isFinite(usd)) return usd
      }
    } catch {
      // not answered on its clock, or not JSON: ask again while there is time
    }
    const left = deadline - Date.now()
    if (left <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, left)))
  }
  return null
}

/** A file's length in seconds, as ffprobe reads it. */
export async function secondsOf(tools, file) {
  const { stdout } = await step('reading a spoken line', tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], CLOCKS.probe)
  return Number(stdout.trim()) || 0
}

/** How far under the narration the film's own sound sits while a line is spoken (the review asked 12–18 dB). */
export const DUCK_UNDER = 15
/** The film's own sound goes down this long before a line starts, and comes back up over this long after it ends. */
const DUCK_IN = 0.15
const DUCK_OUT = 0.3

/**
 * The gain on the film's own sound over time, as an ffmpeg expression of t: 1 between the lines, `under` while one is
 * spoken, with a ramp into each line and out of it (no click, no pumping). The largest dip wins where ramps meet.
 */
export function duckExpression(spans, under) {
  const g = Math.round(under * 10000) / 10000
  const dip = (a, b) => `clip((t-${(a - DUCK_IN).toFixed(3)})/${DUCK_IN},0,1)*clip((${(b + DUCK_OUT).toFixed(3)}-t)/${DUCK_OUT},0,1)`
  const depth = spans.map(([a, b]) => dip(a, b)).reduce((all, one) => `max(${all},${one})`)
  return `1-${(1 - g).toFixed(4)}*${depth}`
}

/**
 * The film with its narration: every line at its start on one mono track brought to TARGET_LUFS (measured alone). A film
 * with a sound of its own (`original`: its loudness) keeps it, lowered while a line is spoken to DUCK_UNDER dB under the
 * narration — never raised, never cut out between the lines; a film without one gets the narration alone. The whole is
 * measured once written and corrected once with one gain for both, and a limiter keeps the peaks. The picture is
 * copied, not re-encoded.
 */
export async function layNarration({ tools, film, lines, seconds, out, original = null }) {
  const inputs = lines.flatMap((line) => ['-i', line.file])
  const delays = lines.map((line, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=mono,adelay=delays=${Math.round(line.at * 1000)}:all=1[a${i + 1}]`)
  const mix = `${delays.join(';')};${lines.map((_, i) => `[a${i + 1}]`).join('')}amix=inputs=${lines.length}:normalize=0:dropout_transition=0,apad,atrim=0:${seconds},aformat=channel_layouts=stereo`
  const loudness = async (name, args) => parseLoudness((await step(name, tools.ffmpeg, ['-hide_banner', '-nostdin', ...args], CLOCKS.pass)).stderr).lufs
  const raw = await loudness('measuring the narration', ['-i', film, ...inputs, '-filter_complex', `${mix},ebur128`, '-f', 'null', '-'])
  if (raw === null) throw new Error('the narration came out silent — try again')
  const narration = TARGET_LUFS - raw
  // The film's own sound under a spoken line: DUCK_UNDER dB under the narration, or as it is when it is quieter already.
  const under = original ? 10 ** (Math.min(0, TARGET_LUFS - DUCK_UNDER - original.lufs) / 20) : 0
  const spans = lines.map((line) => [line.at, line.at + line.seconds])
  const graph = (all) =>
    original
      ? `${mix},volume=${narration}dB[narration];[0:a]aresample=48000,aformat=channel_layouts=stereo,volume='${duckExpression(spans, under)}':eval=frame,apad,atrim=0:${seconds}[bed];` +
        `[bed][narration]amix=inputs=2:normalize=0:duration=first,volume=${all}dB,alimiter=limit=0.84:level=false[out]`
      : `${mix},volume=${narration + all}dB,alimiter=limit=0.84:level=false[out]`
  const write = (all) =>
    step('laying the narration on the film', tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', film, ...inputs,
      '-filter_complex', graph(all),
      '-map', '0:v', '-c:v', 'copy', '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out], CLOCKS.pass)
  let all = 0
  await write(all)
  const written = await loudness('measuring the voiced film', ['-i', out, '-vn', '-af', 'ebur128', '-f', 'null', '-'])
  if (written !== null && Math.abs(written - TARGET_LUFS) > 0.3) {
    all += TARGET_LUFS - written
    await write(all)
  }
  return out
}

/** The person's voice settings, read where the image key is (settings.json in the App's data folder). */
export function voiceOf(settings, asked) {
  const voice = String(asked ?? settings.voice ?? VOICES[0]).toLowerCase()
  if (!VOICES.includes(voice)) throw new Error(`voice ${JSON.stringify(asked)}: one of ${VOICES.join(', ')}`)
  return voice
}
