// 片场 clip reading: what ffmpeg's log is read as, what is refused, and the same on real clips made here.
// Run: node --test tests/*.mjs (the real-clip tests need ffmpeg; they are skipped where there is none).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { MAX_SECONDS, blankStretches, checkClip, ffmpegTools, longestSilence, makeCover, makeStrip, parseLoudness, parseProbe, refusalOf, step, withoutPaths } from '../app/clip.js'

test('ffprobe: length, picture size, and whether there is a sound track', () => {
  const probe = parseProbe({ format: { duration: '31.100000' }, streams: [{ codec_type: 'video', width: 1280, height: 720 }, { codec_type: 'audio' }] })
  assert.deepEqual(probe, { seconds: 31.1, width: 1280, height: 720, hasPicture: true, hasSound: true })
  assert.equal(parseProbe({ format: { duration: '3' }, streams: [{ codec_type: 'video', width: 2, height: 2 }] }).hasSound, false)
})

test('ebur128: the summary\'s integrated loudness and true peak, -inf as nothing', () => {
  const log = '[Parsed_ebur128_0] t: 30.0 M: -17.0 S: -16.9 I: -16.5 LUFS\n[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:         -16.3 LUFS\n    Threshold: -26.4 LUFS\n\n  True peak:\n    Peak:       -1.2 dBFS\n'
  assert.deepEqual(parseLoudness(log), { lufs: -16.3, peak: -1.2 })
  assert.deepEqual(parseLoudness('Summary:\n    I:         -inf LUFS\n    Peak:       -inf dBFS'), { lufs: null, peak: null })
  assert.deepEqual(parseLoudness('no summary at all'), { lufs: null, peak: null })
})

test('silencedetect: the longest run, a run still open at the end closed at the clip\'s length', () => {
  const log = 'silence_start: 4.1\nsilence_end: 5.0 | silence_duration: 0.9\nsilence_start: 26.4\n'
  assert.deepEqual(longestSilence(log, 31.1), { seconds: 4.7, at: 26.4 })
  assert.deepEqual(longestSilence('', 10), { seconds: 0, at: 0 })
})

test('blackdetect: its stretches', () => {
  assert.deepEqual(blankStretches('[blackdetect @ 0x1] black_start:0 black_end:1.5 black_duration:1.5\n'), [[0, 1.5]])
})

test('refused: no picture, no sound track, or a sound nobody can hear (the first table\'s -91 dB films); the rest goes on the card', () => {
  const ok = { hasPicture: true, hasSound: true, lufs: -16.3 }
  assert.equal(refusalOf(ok), null)
  assert.match(refusalOf({ ...ok, hasPicture: false }), /no picture/)
  assert.match(refusalOf({ ...ok, hasSound: false, lufs: null }), /no sound \(no sound track\)/)
  assert.match(refusalOf({ ...ok, lufs: -70 }), /no sound \(loudness -70 LUFS\).*mux the narration in/)
  assert.match(refusalOf({ ...ok, lufs: null }), /no sound \(loudness -inf LUFS\)/)
  assert.match(refusalOf({ ...ok, seconds: MAX_SECONDS + 1 }), /10\.0 minutes long; the table takes clips of up to 10 minutes/)
})

test('a step on a clock: one that runs too long is stopped and said as the step and the computer', async () => {
  await assert.rejects(step('measuring the sound', process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 1000), /^Error: measuring the sound took longer than 1 s on .+ and was stopped$/)
})

test('a step that fails says why in one line, with no path on this machine in it', async () => {
  const failing = ['-e', 'console.error("ffmpeg version x"); console.error("/Users/someone/work/renders/film.mp4: Invalid data found"); process.exit(1)']
  const refused = await step('making the cover', process.execPath, failing, 5000).catch((error) => error)
  assert.match(refused.message, /^making the cover failed on .+: film\.mp4: Invalid data found$/)
  assert.doesNotMatch(refused.message, /Users|someone|-e/)
  assert.equal(withoutPaths('C:\\Users\\x\\film.mp4: bad'), 'film.mp4: bad')
})

// Real clips, made here with ffmpeg's own test sources.
let tools = null
try {
  tools = ffmpegTools()
} catch {}
// Not `studio-clip-…`: that is the name submit's own folders have, which tools.test counts.
const work = mkdtempSync(path.join(tmpdir(), 'studio-test-clips-'))
after(() => rmSync(work, { recursive: true, force: true }))
const make = (name, args) => {
  const out = path.join(work, name)
  execFileSync(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
  return out
}
const picture = (seconds) => ['-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=320x180:rate=10`]

test('a clip with sound: length, size, loudness, the silence in it and no blank screen', { skip: !tools && 'no ffmpeg here' }, async () => {
  // 4 s of a tone with 1.5 s of silence from 1 s on
  const clip = make('voiced.mp4', [...picture(4), '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1,2.5),0,0.3*sin(440*2*PI*t))':d=4:s=48000", '-c:a', 'aac', '-shortest'])
  const check = await checkClip(clip, tools)
  assert.equal(check.width, 320)
  assert.equal(check.height, 180)
  assert.ok(Math.abs(check.seconds - 4) < 0.2, `seconds ${check.seconds}`)
  assert.ok(check.lufs > -30 && check.lufs < -5, `lufs ${check.lufs}`)
  assert.ok(Math.abs(check.silence.seconds - 1.5) <= 0.2 && Math.abs(check.silence.at - 1) <= 0.2, JSON.stringify(check.silence))
  assert.deepEqual(check.black, [])
  assert.equal(refusalOf(check), null)
})

test('a clip whose sound track is silent, and one with no sound track, are refused', { skip: !tools && 'no ffmpeg here' }, async () => {
  const silent = make('silent.mp4', [...picture(3), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-c:a', 'aac', '-shortest'])
  assert.match(refusalOf(await checkClip(silent, tools)), /no sound/)
  const mute = make('mute.mp4', picture(3))
  const check = await checkClip(mute, tools)
  assert.equal(check.hasSound, false)
  assert.match(refusalOf(check), /no sound track/)
})

test('a black stretch is found and kept for the card', { skip: !tools && 'no ffmpeg here' }, async () => {
  const clip = make('black.mp4', [
    '-f', 'lavfi', '-i', 'color=black:size=320x180:rate=10:duration=1.5',
    ...picture(2),
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.5',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:a', 'aac',
  ])
  const check = await checkClip(clip, tools)
  assert.equal(check.black.length, 1)
  assert.ok(check.black[0][0] < 0.1 && Math.abs(check.black[0][1] - 1.5) < 0.2, JSON.stringify(check.black))
})

test('a clip over 10 minutes is answered from its header, before the passes that take as long as the clip', { skip: !tools && 'no ffmpeg here' }, async () => {
  const long = make('long.mp4', ['-f', 'lavfi', '-i', `color=black:size=64x36:rate=1:duration=${MAX_SECONDS + 60}`, '-f', 'lavfi', '-i', `anullsrc=r=8000:cl=mono`, '-t', String(MAX_SECONDS + 60), '-c:a', 'aac'])
  const started = Date.now()
  const check = await checkClip(long, tools)
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`)
  assert.equal(check.lufs, null)
  assert.match(refusalOf(check), /11\.0 minutes long/)
})

test('the cover and the strip are made as jpgs', { skip: !tools && 'no ffmpeg here' }, async () => {
  const clip = make('for-pictures.mp4', [...picture(4), '-f', 'lavfi', '-i', 'sine=duration=4', '-c:a', 'aac', '-shortest'])
  const cover = await makeCover(clip, path.join(work, 'cover.jpg'), 4, tools)
  const strip = await makeStrip(clip, path.join(work, 'strip.jpg'), 4, tools)
  for (const file of [cover, strip]) assert.ok(existsSync(file) && statSync(file).size > 1000, file)
  const width = (file) => Number(execFileSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', file]).toString())
  assert.equal(width(cover), 320)
  assert.equal(width(strip), 8 * 320)
})
