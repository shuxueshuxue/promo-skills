// 片场: a clip handed in, read on the machine that made it (the agent's own): what it is, a check of it, and the
// cover and the strip the table shows. ffmpeg does the reading; the parsers below are plain functions of its log.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * ffmpeg and ffprobe on this computer. gugu started from the desktop does not have the shell's PATH (no Homebrew
 * directory on a Mac), so the usual places are looked in too; STUDIO_FFMPEG names an ffmpeg outright.
 */
export function ffmpegTools(env = process.env) {
  const exe = process.platform === 'win32' ? '.exe' : ''
  const named = env.STUDIO_FFMPEG?.trim()
  const dirs = [
    ...(named ? [path.dirname(named)] : []),
    ...String(env.PATH ?? '').split(path.delimiter).filter(Boolean),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ]
  const dir = dirs.find((d) => existsSync(path.join(d, `ffmpeg${exe}`)) && existsSync(path.join(d, `ffprobe${exe}`)))
  if (!dir) {
    throw new Error(`there is no ffmpeg on this computer (${hostname()}): the table reads a clip with it and makes its cover and strip — install ffmpeg there, or set STUDIO_FFMPEG to it`)
  }
  return { ffmpeg: path.join(dir, `ffmpeg${exe}`), ffprobe: path.join(dir, `ffprobe${exe}`) }
}

/** What ffprobe says of a clip: its length, picture size, and whether it has a sound track at all. */
export function parseProbe(json) {
  const value = typeof json === 'string' ? JSON.parse(json) : json
  const streams = value.streams ?? []
  const picture = streams.find((s) => s.codec_type === 'video')
  return {
    seconds: Number(value.format?.duration) || 0,
    width: Number(picture?.width) || null,
    height: Number(picture?.height) || null,
    hasPicture: Boolean(picture),
    hasSound: streams.some((s) => s.codec_type === 'audio'),
  }
}

/** ebur128's summary: integrated loudness (LUFS) and true peak (dBFS); null when the clip has no sound to measure. */
export function parseLoudness(log) {
  const summary = log.slice(log.lastIndexOf('Summary:'))
  if (!summary.startsWith('Summary:')) return { lufs: null, peak: null }
  const lufs = summary.match(/\bI:\s+(-?[\d.]+|-inf)\s+LUFS/)
  const peak = summary.match(/\bPeak:\s+(-?[\d.]+|-inf)\s+dBFS/)
  const number = (m) => (m && m[1] !== '-inf' ? Number(m[1]) : null)
  return { lufs: number(lufs), peak: number(peak) }
}

/** silencedetect's runs, the last one closed at the clip's end; the longest, rounded to tenths. */
export function longestSilence(log, seconds) {
  const runs = []
  let open = null
  for (const m of log.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const t = Math.max(0, Number(m[2]))
    if (m[1] === 'start') open = t
    else if (open !== null) {
      runs.push([open, t])
      open = null
    }
  }
  if (open !== null) runs.push([open, seconds])
  const longest = runs.reduce((best, run) => (run[1] - run[0] > best[1] - best[0] ? run : best), [0, 0])
  const tenth = (n) => Math.round(n * 10) / 10
  return { seconds: tenth(longest[1] - longest[0]), at: tenth(longest[0]) }
}

/** blackdetect's stretches, as [start, end] in seconds. */
export function blankStretches(log) {
  return [...log.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
}

/**
 * What the table refuses outright, said to the agent: a clip with no picture, or one nobody can hear (a film without
 * its narration came in twice at -91 dB on the first table). Everything else goes on the card for people to judge.
 */
export function refusalOf(check) {
  if (!check.hasPicture) return 'it has no picture'
  if (!check.hasSound || check.lufs === null || check.lufs <= -60) {
    return `it has no sound (${check.hasSound ? `loudness ${check.lufs === null ? '-inf' : check.lufs} LUFS` : 'no sound track'}) — mux the narration in and check it plays before you hand it in`
  }
  return null
}

const stderrOf = async (tools, args) => {
  // ffmpeg writes what the filters measured to stderr and exits 0.
  const { stderr } = await run(tools.ffmpeg, ['-hide_banner', '-nostdin', ...args], { maxBuffer: 64 * 1024 * 1024 })
  return stderr
}

/** The check of a clip, in one place: length, size, sound (loudness, peak, longest silence) and blank screens. */
export async function checkClip(file, tools = ffmpegTools()) {
  const { stdout } = await run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file])
  const probe = parseProbe(stdout)
  const check = { ...probe, lufs: null, peak: null, silence: { seconds: 0, at: 0 }, black: [], white: [] }
  if (probe.hasSound) {
    const log = await stderrOf(tools, ['-i', file, '-vn', '-af', 'ebur128=peak=true,silencedetect=noise=-40dB:d=0.25', '-f', 'null', '-'])
    Object.assign(check, parseLoudness(log), { silence: longestSilence(log, probe.seconds) })
  }
  if (probe.hasPicture) {
    check.black = blankStretches(await stderrOf(tools, ['-i', file, '-an', '-vf', 'blackdetect=d=0.4:pix_th=0.10', '-f', 'null', '-']))
    check.white = blankStretches(await stderrOf(tools, ['-i', file, '-an', '-vf', 'negate,blackdetect=d=0.4:pix_th=0.07:pic_th=0.99', '-f', 'null', '-']))
  }
  return check
}

/** The cover: one frame, a third of the way in (at most 5 s), at most 720 high, as a jpg. */
export async function makeCover(file, out, seconds, tools = ffmpegTools()) {
  const at = Math.min(5, Math.max(0, seconds / 3))
  await run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', "scale=-2:'min(720,ih)'", '-q:v', '3', out])
  return out
}

/** The strip: 8 frames evenly through the clip, 320 wide each, side by side in one jpg. */
export async function makeStrip(file, out, seconds, tools = ffmpegTools()) {
  const rate = 8 / Math.max(seconds, 0.1)
  await run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', file, '-vf', `fps=${rate},scale=320:-2,tile=8x1`, '-frames:v', '1', '-q:v', '4', out])
  return out
}
