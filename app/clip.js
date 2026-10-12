// 片场: a clip handed in, read on the machine that made it (the agent's own): what it is, a check of it, and the
// cover and the strip the table shows. ffmpeg does the reading; the parsers below are plain functions of its log.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)

/** The longest clip the table takes: a promo film runs minutes, and reading a clip takes as long as the clip is long. */
export const MAX_SECONDS = 10 * 60

/**
 * One ffmpeg or ffprobe step, on a clock: what it took longer than, or why it failed, said as the step and the computer
 * — never the command line or a path on this machine (a file is named by its own name).
 */
export async function step(name, file, args, timeout) {
  try {
    return await execute(file, args, { timeout, maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    if (error.killed || error.signal === 'SIGTERM') throw new Error(`${name} took longer than ${Math.round(timeout / 1000)} s on ${hostname()} and was stopped`)
    const last = String(error.stderr || error.message || '').split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? 'no reason given'
    throw new Error(`${name} failed on ${hostname()}: ${withoutPaths(last)}`)
  }
}

/** A line with every absolute path in it cut to the file's own name. */
export const withoutPaths = (line) => line.replace(/(?:[A-Za-z]:)?(?:[\\/][^\\/\s:'"]+)+/g, (p) => p.split(/[\\/]/).pop())

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
  if (check.seconds > MAX_SECONDS) return `it is ${(check.seconds / 60).toFixed(1)} minutes long; the table takes clips of up to ${MAX_SECONDS / 60} minutes`
  if (!check.hasPicture) return 'it has no picture'
  if (!check.hasSound || check.lufs === null || check.lufs <= -60) {
    return `it has no sound (${check.hasSound ? `loudness ${check.lufs === null ? '-inf' : check.lufs} LUFS` : 'no sound track'}) — mux the narration in and check it plays before you hand it in`
  }
  return null
}

/** Each step's clock: reading the header is quick; a pass through a clip of up to MAX_SECONDS is not. */
export const CLOCKS = { probe: 20_000, pass: 120_000, cover: 30_000, strip: 120_000 }

const stderrOf = async (tools, name, args) => {
  // ffmpeg writes what the filters measured to stderr and exits 0.
  const { stderr } = await step(name, tools.ffmpeg, ['-hide_banner', '-nostdin', ...args], CLOCKS.pass)
  return stderr
}

/**
 * The check of a clip, in one place: length, size, sound (loudness, peak, longest silence) and blank screens. A clip
 * longer than MAX_SECONDS is answered from its header alone (refusalOf refuses it): the three passes take as long as
 * the clip.
 */
export async function checkClip(file, tools = ffmpegTools()) {
  const { stdout } = await step('reading the clip', tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], CLOCKS.probe)
  const probe = parseProbe(stdout)
  const check = { ...probe, lufs: null, peak: null, silence: { seconds: 0, at: 0 }, black: [], white: [] }
  if (probe.seconds > MAX_SECONDS) return check
  if (probe.hasSound) {
    const log = await stderrOf(tools, 'measuring the sound', ['-i', file, '-vn', '-af', 'ebur128=peak=true,silencedetect=noise=-40dB:d=0.25', '-f', 'null', '-'])
    Object.assign(check, parseLoudness(log), { silence: longestSilence(log, probe.seconds) })
  }
  if (probe.hasPicture) {
    check.black = blankStretches(await stderrOf(tools, 'looking for black screens', ['-i', file, '-an', '-vf', 'blackdetect=d=0.4:pix_th=0.10', '-f', 'null', '-']))
    check.white = blankStretches(await stderrOf(tools, 'looking for white screens', ['-i', file, '-an', '-vf', 'negate,blackdetect=d=0.4:pix_th=0.07:pic_th=0.99', '-f', 'null', '-']))
  }
  return check
}

/** The cover: one frame, a third of the way in (at most 5 s), at most 720 high, as a jpg. */
export async function makeCover(file, out, seconds, tools = ffmpegTools()) {
  const at = Math.min(5, Math.max(0, seconds / 3))
  await step('making the cover', tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', "scale=-2:'min(720,ih)'", '-q:v', '3', out], CLOCKS.cover)
  return out
}

/** The strip: 8 frames evenly through the clip, 320 wide each, side by side in one jpg. */
export async function makeStrip(file, out, seconds, tools = ffmpegTools()) {
  const rate = 8 / Math.max(seconds, 0.1)
  await step('making the strip', tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', file, '-vf', `fps=${rate},scale=320:-2,tile=8x1`, '-frames:v', '1', '-q:v', '4', out], CLOCKS.strip)
  return out
}
