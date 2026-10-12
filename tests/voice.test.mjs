// 片场 voice: the narration's fit and the advice when a line runs over (plain functions), and the voice tool against a
// stand-in for the voice service (real mp3s made with ffmpeg): the voiced film, what the table records it cost, a
// retry that pays only for what changed, samples handed in as cards. Run: node --test tests/*.mjs (needs ffmpeg).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { checkClip, ffmpegTools } from '../app/clip.js'
import { spendOf } from '../app/model.js'
import { catchUp, costOf, linesOf, overrunMessage, overruns, speak, spokenLength, voiceOf } from '../app/voice.js'

test('what takes time to say: letters, digits and Han characters — not spaces or punctuation', () => {
  assert.equal(spokenLength('在咕咕，开工就是一句话。'), 10)
  assert.equal(spokenLength('p99 4.38 ms'), 8)
})

test('lines: text, a start inside the film, in the order spoken', () => {
  assert.deepEqual(linesOf([{ text: ' 一 ', at: 0 }, { text: '二', at: 2.5 }], 10), [{ text: '一', at: 0 }, { text: '二', at: 2.5 }])
  assert.throws(() => linesOf([], 10), /each line as \{ text, at \}/)
  assert.throws(() => linesOf([{ text: '', at: 0 }], 10), /line 1 has no text/)
  assert.throws(() => linesOf([{ text: '一', at: 10 }], 10), /line 1 starts at 10: .*before the film ends \(10 s\)/)
  assert.throws(() => linesOf([{ text: '一', at: 3 }, { text: '二', at: 3 }], 10), /line 2 starts at 3 s, not after line 1/)
})

test('a line that runs into the next, or past the end: by how much, and about how many characters fit at the pace it was said', () => {
  const lines = [
    { text: '一二三四五六七八九十', at: 0, seconds: 3 },
    { text: '好', at: 2, seconds: 0.5 },
    { text: '一二三四', at: 9, seconds: 2 },
  ]
  const problems = overruns(lines, 10)
  assert.deepEqual(problems.map((p) => [p.n, p.fit, p.chars, Math.round(p.over * 10) / 10]), [[1, 6, 10, 1], [3, 2, 4, 1]])
  const said = overrunMessage(problems)
  assert.match(said, /line 1 \(「一二三四五六七八九十」\) lasts 3 s but has 2 s before line 2 starts — 1 s over: cut it to about 6 characters \(it has 10\), or start line 2 later/)
  assert.match(said, /line 3 \(「一二三四」\) lasts 2 s but has 1 s before the film ends — 1 s over: cut it to about 2 characters \(it has 4\), or start it earlier/)
  assert.deepEqual(overruns([{ text: '好', at: 0, seconds: 1 }, { text: '好', at: 1, seconds: 1 }], 5), [])
})

test('the voice: the one asked, else the table\'s, else eve — and only one the model has', () => {
  assert.equal(voiceOf({}, undefined), 'eve')
  assert.equal(voiceOf({ voice: 'rex' }, undefined), 'rex')
  assert.equal(voiceOf({ voice: 'rex' }, 'Sal'), 'sal')
  assert.throws(() => voiceOf({}, 'alloy'), /one of eve, ara, rex, sal, leo/)
})

test('a purchase\'s price: waited for (its record comes seconds later), the upstream cost for a key that brings its own, null when it never comes', async () => {
  const saved = globalThis.fetch
  try {
    let asked = 0
    globalThis.fetch = async () => (++asked < 3
      ? new Response('{"error":{"message":"Generation not found","code":404}}', { status: 404 })
      : new Response(JSON.stringify({ data: { is_byok: true, total_cost: 0.0001, upstream_inference_cost: 0.002 } }), { status: 200 }))
    assert.equal(await costOf('k', 'gen-1', { deadline: Date.now() + 2000, wait: 1 }), 0.002)
    assert.equal(asked, 3)
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { is_byok: false, total_cost: 0.000015, upstream_inference_cost: 0 } }), { status: 200 })
    assert.equal(await costOf('k', 'gen-2', { deadline: Date.now() + 2000, wait: 1 }), 0.000015)
    globalThis.fetch = async () => new Response('{}', { status: 404 })
    assert.equal(await costOf('k', 'gen-3', { deadline: Date.now() + 50, wait: 1 }), null)
    assert.equal(await costOf('k', null), 0)
  } finally {
    globalThis.fetch = saved
  }
})

// A clock-less lookup hangs here, and the test's own timeout fails it (review r3, P3: the stand-in threw at once without a
// signal, which read as giving up in time).
test('a price lookup that never answers costs its clock, not the call: not priced, said in time (review d00ad0e)', { timeout: 5000 }, async () => {
  const saved = globalThis.fetch
  try {
    // A service that holds every request open until it is given up on — forever, when nothing gives up on it.
    const hang = (init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal.reason)))
    globalThis.fetch = (_url, init) => hang(init)
    let started = Date.now()
    assert.equal(await costOf('k', 'gen-hang', { deadline: Date.now() + 300, each: 5000, wait: 1 }), null)
    assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms past a 300 ms deadline`)
    // Each ask has its own clock too: one hung ask does not take the whole deadline.
    let asks = 0
    globalThis.fetch = (_url, init) => {
      asks += 1
      return asks === 1
        ? hang(init)
        : Promise.resolve(new Response(JSON.stringify({ data: { total_cost: 0.003 } }), { status: 200 }))
    }
    started = Date.now()
    assert.equal(await costOf('k', 'gen-slow', { deadline: Date.now() + 5000, each: 200, wait: 1 }), 0.003)
    assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`)
  } finally {
    globalThis.fetch = saved
  }
})

test('two catch-ups on one table at once: what the other priced meanwhile is not added again, and does not stop the rest (review r3)', async () => {
  const saved = globalThis.fetch
  try {
    const spend = {
      s1: { tool: 'voice', usd: 0, unpriced: 1, pending: ['g1'] },
      s2: { tool: 'image', usd: 0.03, unpriced: 1, pending: ['g2'] },
    }
    const price = { g1: 0.001, g2: 0.002 }
    const answer = (url) => new Response(JSON.stringify({ data: { total_cost: price[new URL(url).searchParams.get('id')] } }), { status: 200 })
    // The first call's lookups wait at a gate; the second's are answered at once.
    let open
    const gate = new Promise((resolve) => { open = resolve })
    let asks = 0
    globalThis.fetch = async (url) => (++asks <= 2 ? gate.then(() => answer(url)) : answer(url))
    const first = catchUp(spend, 'k', Date.now() + 5000)
    // The second runs whole while the first waits: it prices both.
    assert.equal(await catchUp(spend, 'k', Date.now() + 5000), true)
    assert.deepEqual([spend.s1.pending, spend.s2.pending], [undefined, undefined])
    open()
    // The first finds nothing left to add — no error, nothing counted twice.
    assert.equal(await first, false)
    near(spend.s1.usd, 0.001)
    near(spend.s2.usd, 0.032)
    // One entry priced meanwhile, another still owed: the first one's wait ends with the other added.
    const half = { s1: { tool: 'voice', usd: 0, unpriced: 1, pending: ['g1'] }, s2: { tool: 'image', usd: 0, unpriced: 1, pending: ['g2'] } }
    let release
    const later = new Promise((resolve) => { release = resolve })
    asks = 0
    globalThis.fetch = async (url) => (++asks <= 2 ? later.then(() => answer(url)) : answer(url))
    const slow = catchUp(half, 'k', Date.now() + 5000)
    // Someone else prices only s1 (s2's record not there for them).
    globalThis.fetch = async (url) => (url.includes('g2') ? new Response('{}', { status: 404 }) : answer(url))
    await catchUp({ s1: half.s1 }, 'k', Date.now() + 50)
    assert.equal(half.s1.pending, undefined)
    release()
    assert.equal(await slow, true)
    near(half.s1.usd, 0.001)
    near(half.s2.usd, 0.002)
    assert.equal(half.s2.pending, undefined)
  } finally {
    globalThis.fetch = saved
  }
})

// The voice tool, end to end on this computer: a stand-in for OpenRouter that answers speech with real mp3s.
let tools = null
try {
  tools = ffmpegTools()
} catch {}
const noFfmpeg = !tools && 'no ffmpeg here'
const work = mkdtempSync(path.join(tmpdir(), 'studio-test-voice-'))
const data = mkdtempSync(path.join(tmpdir(), 'studio-test-voice-data-'))
after(() => {
  rmSync(work, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})
process.env.GUGU_EXTENSION_DATA_DIR = data
const { submit, voice } = await import('../app/tools.js')
const { PRICING } = await import('../app/voice.js')
const call = { agent: 'user:a', session: 's-1', workspaceRoot: work }
const mp3 = (seconds) => {
  const out = path.join(data, `tone-${seconds}.mp3`)
  if (!existsSync(out)) execFileSync(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-c:a', 'libmp3lame', out])
  return readFileSync(out)
}
const service = { spoken: [], priced: 0, ready: true }
function standIn() {
  service.spoken = []
  service.ready = true
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/audio/speech')) {
      const body = JSON.parse(init.body)
      service.spoken.push([body.voice, body.input])
      // A line marked LONG is said slowly: 3 s; any other 1 s.
      return new Response(mp3(body.input.includes('LONG') ? 3 : 1), { status: 200, headers: { 'content-type': 'audio/mpeg', 'x-generation-id': `gen-${service.spoken.length}` } })
    }
    if (String(url).includes('/generation?id=')) {
      // Not ready: the service has no record of the purchase yet (as for the first ~12 s of a real one).
      if (!service.ready) return new Response('{"error":{"message":"Generation not found","code":404}}', { status: 404 })
      service.priced += 1
      return new Response(JSON.stringify({ data: { total_cost: 0.002 } }), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
}
function table() {
  const board = { brief: '', rounds: { r1: { n: 1, track: '片子', kind: '配音', slot: '挑声音', ask: '', each: 5, agents: ['user:a'], refs: [] } }, cards: {}, feedback: {}, rules: {}, names: {}, spend: {} }
  const uploads = []
  globalThis.gugu = {
    files: {
      open: async () => ({ data: board, toJSON: () => structuredClone(board), transact: (fn) => fn(), saved: true, onStatus() {}, close() {}, entry: { id: 'table', chat: 'chat-1', name: 't.studio.json' } }),
      upload: async (place, files) => {
        uploads.push({ place, files: files.map((f) => ({ name: f.name, type: f.type })) })
        return files.map((_, i) => ({ id: `item-${uploads.length}-${i}` }))
      },
    },
  }
  return { board, uploads }
}
const key = (value) => writeFileSync(path.join(data, 'settings.json'), JSON.stringify(value ? { openrouterKey: value } : {}))
const film = (name, seconds) => {
  mkdirSync(path.join(work, 'renders'), { recursive: true })
  execFileSync(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=320x180:rate=10`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'renders', name)])
  return `renders/${name}`
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)
const pictureOf = (file) => createHash('sha256').update(execFileSync(tools.ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v', '-c', 'copy', '-f', 'data', '-'])).digest('hex')

test('without the person\'s key there is no voice, and no placeholder either', { skip: noFfmpeg }, async () => {
  key(null)
  table()
  await assert.rejects(voice.run({ board: 'table', film: film('nokey.mp4', 3), lines: [{ text: '一', at: 0 }] }, call), /No voice key yet: .*there is no placeholder voice/)
})

test('a film voiced: each line at its start, at -16 LUFS, the picture untouched, and what it cost on the table', { skip: noFfmpeg }, async () => {
  key('test-key')
  standIn()
  const { board } = table()
  const p = film('cut.mp4', 6)
  const answer = await voice.run({ board: 'table', film: p, voice: 'rex', lines: [{ text: '第一句', at: 0.5 }, { text: '第二句', at: 3 }] }, call)
  // In the caller's own folder for the table (review r4), not beside the film.
  assert.equal(answer.path, 'studio/t/a/cut.voiced.mp4')
  assert.deepEqual(service.spoken, [['Rex', '第一句'], ['Rex', '第二句']])
  const out = path.join(work, answer.path)
  const check = await checkClip(out, tools)
  assert.ok(check.hasSound && Math.abs(check.lufs - -16) <= 1, `lufs ${check.lufs}`)
  assert.equal(pictureOf(out), pictureOf(path.join(work, p)))
  assert.equal(answer.usd, 0.004)
  assert.deepEqual(spendOf(board), { total: 0.004, byTool: { voice: 0.004 }, unknown: 0 })
})

test('a line that runs over is refused with how much and how many characters fit; the retry pays only for what changed', { skip: noFfmpeg }, async () => {
  key('test-key')
  standIn()
  const { board } = table()
  const p = film('tight.mp4', 6)
  const lines = [{ text: '开头一句', at: 0 }, { text: 'LONG 这一句说得太长了', at: 2 }, { text: '收尾', at: 4 }]
  await assert.rejects(voice.run({ board: 'table', film: p, lines }, call), /line 2 \(「LONG 这一句说得太长了」\) lasts 3(\.\d+)? s but has 2 s before line 3 starts — 1(\.\d+)? s over: cut it to about [78] characters \(it has 12\), or start line 3 later/)
  // What was bought before the refusal is on the table all the same.
  assert.equal(service.spoken.length, 3)
  near(spendOf(board).total, 0.006)
  lines[1] = { text: '这一句改短了', at: 2 }
  const answer = await voice.run({ board: 'table', film: p, lines }, call)
  assert.deepEqual(service.spoken.slice(3), [['Eve', '这一句改短了']])
  near(answer.usd, 0.002)
  near(spendOf(board).total, 0.008)
})

test('a film over 10 minutes is refused before a line is spoken', { skip: noFfmpeg }, async () => {
  key('test-key')
  standIn()
  table()
  const out = path.join(work, 'renders', 'long.mp4')
  execFileSync(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:size=64x36:rate=1:duration=660', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
  await assert.rejects(voice.run({ board: 'table', film: 'renders/long.mp4', lines: [{ text: '一', at: 0 }] }, call), /11\.0 minutes long; the table takes films of up to 10 minutes/)
  assert.deepEqual(service.spoken, [])
})

test('voice samples: one mp3 per voice, each handed in as its own card that plays it', { skip: noFfmpeg }, async () => {
  key('test-key')
  standIn()
  const { board, uploads } = table()
  const answer = await voice.run({ board: 'table', sample: '在咕咕，开工就是一句话。', voices: ['eve', 'rex'] }, call)
  // In the writer's own folder for the table (trial 10-12: writers on one computer shared one working copy).
  assert.deepEqual(answer.samples, [{ voice: 'eve', path: 'studio/t/a/voice-samples/eve.mp3' }, { voice: 'rex', path: 'studio/t/a/voice-samples/rex.mp3' }])
  for (const sample of answer.samples) {
    const card = await submit.run({ board: 'table', round: 'r1', title: `声音 ${sample.voice}`, audio: { path: sample.path } }, call)
    assert.deepEqual(board.cards[card.card].files, [`item-${uploads.length}-0`])
  }
  // Named by the file and its hash, as covers are: another card's eve.mp3 is another name.
  const sha8 = (p) => createHash('sha256').update(readFileSync(path.join(work, p))).digest('hex').slice(0, 8)
  assert.deepEqual(uploads.map((u) => u.files.map((f) => [f.name, f.type])), [[[`eve-${sha8(answer.samples[0].path)}.mp3`, 'audio/mpeg']], [[`rex-${sha8(answer.samples[1].path)}.mp3`, 'audio/mpeg']]])
  assert.equal(spendOf(board).total, 0.004)
})

test('purchases not priced in time keep their ids on the table; the next call prices them and the total catches up (review d00ad0e)', { skip: noFfmpeg }, async () => {
  key('test-key')
  standIn()
  const { board } = table()
  const saved = { ...PRICING }
  Object.assign(PRICING, { wait: 300, catchUp: 3000 })
  try {
    service.ready = false
    const first = await voice.run({ board: 'table', sample: '还没出账的那一句', voices: ['eve'] }, call)
    assert.deepEqual([first.usd, first.unpriced], [0, 1])
    const [entry] = Object.values(board.spend)
    assert.deepEqual([entry.usd, entry.unpriced, entry.pending], [0, 1, ['gen-1']])
    assert.deepEqual(spendOf(board), { total: 0, byTool: { voice: 0 }, unknown: 1 })
    service.ready = true
    await voice.run({ board: 'table', sample: '下一句', voices: ['eve'] }, call)
    assert.deepEqual([entry.usd, entry.unpriced, entry.pending], [0.002, undefined, undefined])
    assert.deepEqual(spendOf(board), { total: 0.004, byTool: { voice: 0.004 }, unknown: 0 })
  } finally {
    Object.assign(PRICING, saved)
  }
})

test('a line is kept only once it is a sound, and kept per model, voice and text (review d00ad0e)', { skip: noFfmpeg }, async () => {
  const cacheDir = mkdtempSync(path.join(data, 'cache-'))
  const saved = globalThis.fetch
  let bought = 0
  let answer = 'json'
  globalThis.fetch = async () => {
    bought += 1
    return answer === 'json'
      ? new Response('{"error":{"message":"upstream busy"}}', { status: 200, headers: { 'content-type': 'application/json' } })
      : answer === 'junk'
        ? new Response('not an mp3 at all', { status: 200, headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-junk' } })
        : new Response(mp3(1), { status: 200, headers: { 'content-type': 'audio/mpeg', 'x-generation-id': `gen-${bought}` } })
  }
  try {
    const line = { key: 'k', voice: 'eve', text: '同一句', cacheDir, tools }
    await assert.rejects(speak({ ...line, model: 'm1' }), /answered application\/json, not a sound: \{"error":\{"message":"upstream busy"\}\}/)
    answer = 'junk'
    await assert.rejects(speak({ ...line, model: 'm1' }), /what the voice service sent cannot be played/)
    assert.deepEqual(readdirSync(cacheDir), [], 'nothing kept from either answer')
    answer = 'audio'
    const first = await speak({ ...line, model: 'm1' })
    assert.equal((await speak({ ...line, model: 'm1' })).generation, null, 'the same line again is not bought')
    const other = await speak({ ...line, model: 'm2' })
    assert.notEqual(other.file, first.file)
    assert.ok(other.generation, 'another model is another line: bought')
    assert.equal(bought, 4)
  } finally {
    globalThis.fetch = saved
  }
})

// How loud one tone is in a stretch of a file: the band around it only (narration is 330 Hz here, the "music" 220 Hz).
const bandLevel = (file, from, seconds, freq) => {
  // volumedetect writes to stderr.
  const { stderr } = spawnSync(tools.ffmpeg, ['-hide_banner', '-nostdin', '-ss', String(from), '-t', String(seconds), '-i', file, '-vn', '-af', `bandpass=f=${freq}:width_type=q:w=30,volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' })
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr)?.[1])
}

/**
 * A film whose own sound is a 220 Hz tone at this gain (null: no sound of its own), voiced: its levels, read — the
 * narration in its first line (1.3–1.8 s), the film's sound there and where no line is (`between`). The tone is stereo,
 * as the voiced film is: a mono one is spread over two channels 3 dB down each (the same loudness), which would read as
 * 3 dB less per sample here.
 */
async function voicedOver(name, gain, { seconds = 6, lines = [{ text: '甲', at: 1 }, { text: '乙', at: 3.5 }], between = [5.1, 0.7] } = {}) {
  mkdirSync(path.join(work, 'renders'), { recursive: true })
  const film = path.join(work, 'renders', `${name}.mp4`)
  const sound = gain === null ? [] : ['-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds},volume=${gain}`]
  execFileSync(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=320x180:rate=10`, ...sound,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(gain === null ? [] : ['-c:a', 'aac', '-ac', '2', '-shortest']), film])
  const answer = await voice.run({ board: 'table', film: `renders/${name}.mp4`, lines }, call)
  const out = path.join(work, answer.path)
  const written = await checkClip(out, tools)
  return {
    film: gain === null ? null : (await checkClip(film, tools)).lufs,
    before: gain === null ? null : bandLevel(film, ...between, 220), // the film's own sound where no line will be
    between: bandLevel(out, ...between, 220),
    under: bandLevel(out, 1.3, 0.5, 220),
    voice: bandLevel(out, 1.3, 0.5, 330),
    whole: written.lufs,
    peak: written.peak,
  }
}

test('turnDown: the whole film only ever goes down — by what is over -14 LUFS or -1 dBTP, the larger — else not at all (148, review r4)', async () => {
  const { turnDown } = await import('../app/voice.js')
  assert.equal(turnDown({ lufs: -16, peak: -3 }), 0)
  // A film with little said, quieter than -16: left as it is, not raised.
  assert.equal(turnDown({ lufs: -22.5, peak: -9 }), 0)
  near(turnDown({ lufs: -12.5, peak: -3 }), -1.5)
  near(turnDown({ lufs: -16, peak: -0.4 }), -0.6)
  near(turnDown({ lufs: -13, peak: 0.5 }), -1.5)
  assert.equal(turnDown({ lufs: null, peak: null }), 0)
})

test('a voiced film goes into the caller\'s own folder, whoever\'s film it voices: a writer never writes over another\'s (review r4)', { skip: noFfmpeg }, async () => {
  key('test-key')
  standIn()
  table()
  const [a, b] = [{ ...call, agent: 'user:aaaaaaaa-1' }, { ...call, agent: 'user:bbbbbbbb-2' }]
  const cut = 'studio/t/aaaaaaaa/cut.mp4'
  mkdirSync(path.dirname(path.join(work, cut)), { recursive: true })
  execFileSync(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x180:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, cut)])
  const sha = (p) => createHash('sha256').update(readFileSync(path.join(work, p))).digest('hex')
  const mine = await voice.run({ board: 'table', film: cut, lines: [{ text: '甲', at: 0.5 }] }, a)
  assert.equal(mine.path, 'studio/t/aaaaaaaa/cut.voiced.mp4')
  const before = sha(mine.path)
  // B voices A's cut: B's own folder gets it, A's voiced film is as it was.
  const theirs = await voice.run({ board: 'table', film: cut, voice: 'rex', lines: [{ text: '乙', at: 0.5 }] }, b)
  assert.equal(theirs.path, 'studio/t/bbbbbbbb/cut.voiced.mp4')
  assert.equal(sha(mine.path), before)
})

test('a film with a sound of its own keeps it: there between the lines, and 12–18 dB under the narration while a line is spoken (review d00ad0e)', { skip: noFfmpeg }, async () => {
  key('test-key')
  standIn()
  table()
  const { between, under, voice: voiceOver, whole } = await voicedOver('music', 2)
  assert.ok(between > -40, `the music is still there between the lines (${between} dB)`)
  // Between the lines it is at BED_LUFS (8 dB under the narration) already: under one it goes down the rest of the way.
  assert.ok(between - under >= 5, `under a line the music goes down (${between} → ${under} dB)`)
  const gap = voiceOver - under
  assert.ok(gap >= 12 && gap <= 18, `under a line the music sits 12–18 dB under the narration (${gap.toFixed(1)} dB)`)
  assert.ok(whole <= -14 + 0.3, `the whole no louder than -14 LUFS (${whole})`)
})

test('the film\'s own sound is brought to one level first: the narration sits the same on a medium and a loud film, and a quiet one is not raised (review r3)', { skip: noFfmpeg }, async (t) => {
  key('test-key')
  standIn()
  table()
  const quiet = await voicedOver('quiet', 0.05)
  const medium = await voicedOver('medium', 2)
  const loud = await voicedOver('loud', 7)
  const r = (n) => n.toFixed(1)
  const said = (x) => `film ${r(x.film)} LUFS: voice ${r(x.voice)}, between ${r(x.between)} (was ${r(x.before)}), under ${r(x.under)}, whole ${r(x.whole)}`
  for (const x of [quiet, medium, loud]) t.diagnostic(said(x))
  // Three films, from well under BED_LUFS to well over -16.
  assert.ok(quiet.film < -40 && medium.film > -20 && loud.film > -9, [quiet, medium, loud].map(said).join(' | '))
  // The louder film no longer takes the narration down with it (was -8.6 dB at -5 LUFS), nor sits over it between lines.
  assert.ok(Math.abs(loud.voice - medium.voice) <= 1.5, `the narration: ${said(medium)} | ${said(loud)}`)
  assert.ok(Math.abs(loud.between - medium.between) <= 1.5, `its sound between the lines: ${said(medium)} | ${said(loud)}`)
  assert.ok(medium.voice - medium.between >= 4, `the narration over the film's sound between lines too: ${said(medium)}`)
  for (const x of [medium, loud]) {
    const gap = x.voice - x.under
    assert.ok(gap >= 12 && gap <= 18, `under a line 12–18 dB under the narration: ${said(x)}`)
  }
  // Quieter than BED_LUFS: as it was between the lines — never raised (review r3, D3).
  assert.ok(Math.abs(quiet.between - quiet.before) <= 1, `a quiet film's sound is not raised: ${r(quiet.before)} → ${r(quiet.between)} dB`)
  // The narration, the fixed point, is the same over all three; no whole is louder than -14 LUFS.
  assert.ok(Math.abs(quiet.voice - medium.voice) <= 1.5, `the narration: ${said(quiet)} | ${said(medium)}`)
  for (const x of [quiet, medium, loud]) assert.ok(x.whole <= -14 + 0.3, `the whole no louder than -14 LUFS: ${said(x)}`)
})

test('the narration is the fixed point: the same with much or little said and on a 10-minute film — the whole is never raised, only turned down past -14 LUFS or -1 dBTP (148, review r4)', { skip: noFfmpeg, timeout: 240_000 }, async (t) => {
  key('test-key')
  standIn()
  table()
  const r = (n) => (n === null ? '—' : n.toFixed(1))
  const said = (x) => `voice ${r(x.voice)}, between ${r(x.between)} (was ${r(x.before)}), under ${r(x.under)}, whole ${r(x.whole)} LUFS, true peak ${r(x.peak)}`
  // No sound of its own: the narration alone, as it is laid.
  const alone = await voicedOver('alone', null)
  // Much said: five 1 s lines in 6 s. Little said: one line in 6 s. Ten minutes, twenty lines (one every 30 s).
  const dense = await voicedOver('dense', 2, { lines: [0, 1.1, 2.2, 3.3, 4.4].map((at, i) => ({ text: `密 ${i}`, at })), between: [5.75, 0.2] })
  const sparse = await voicedOver('sparse', 2, { lines: [{ text: '甲', at: 1 }] })
  const long = await voicedOver('long', 2, { seconds: 600, lines: Array.from({ length: 20 }, (_, i) => ({ text: `长 ${i}`, at: 1 + i * 30 })), between: [15, 1] })
  for (const [name, x] of Object.entries({ alone, dense, sparse, long })) t.diagnostic(`${name}: ${said(x)}`)
  // The narration does not move with how much is said or how long the film is (was +2.5 dB at a third, +6 dB on 10 min).
  for (const x of [dense, sparse, long]) assert.ok(Math.abs(x.voice - alone.voice) <= 1.5, `the narration: alone ${said(alone)} | ${said(x)}`)
  // The film's own sound between the lines is where BED_LUFS put it, the long film's too (it went up to -20.5 before).
  assert.ok(Math.abs(long.between - sparse.between) <= 1, `between the lines: ${said(sparse)} | ${said(long)}`)
  // Never raised: the less said, the quieter the whole; never over -14 LUFS or -1 dBTP.
  assert.ok(alone.whole >= -17 && alone.whole <= -15, `the narration alone at -16 LUFS: ${said(alone)}`)
  assert.ok(sparse.whole < -16.5 && long.whole < sparse.whole, `little said comes out quieter: ${said(sparse)} | ${said(long)}`)
  for (const x of [alone, dense, sparse, long]) assert.ok(x.whole <= -14 + 0.3 && x.peak <= -1 + 0.3, `within -14 LUFS and -1 dBTP: ${said(x)}`)
})
