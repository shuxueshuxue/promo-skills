// 片场 tools: what submit refuses about a clip before it touches the table, and what it puts on the card and in the
// chat for one it takes. Run: node --test tests/*.mjs (the clip tests need ffmpeg; skipped where there is none).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { ffmpegTools } from '../app/clip.js'
import { submit } from '../app/tools.js'

const work = mkdtempSync(path.join(tmpdir(), 'studio-tools-'))
const outside = mkdtempSync(path.join(tmpdir(), 'studio-outside-'))
after(() => {
  rmSync(work, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})
mkdirSync(path.join(work, 'renders'))
writeFileSync(path.join(work, 'renders', 'cut.720p.mp4'), 'clip')
writeFileSync(path.join(work, 'renders', 'master.mp4'), '')
truncateSync(path.join(work, 'renders', 'master.mp4'), 25 * 1024 * 1024 + 1)
writeFileSync(path.join(outside, 'secret.mp4'), 'not yours')
symlinkSync(path.join(outside, 'secret.mp4'), path.join(work, 'renders', 'link.mp4'))

const call = { agent: 'user:a', session: 's-1', workspaceRoot: work }
const hand = (p, stamp = call, title = 't') => submit.run({ board: 'table', round: 'r1', ...(title ? { title } : {}), video: { path: p } }, stamp)

test('an original over 25 MB is refused at submit, saying the limit and what to hand in instead', async () => {
  await assert.rejects(hand('renders/master.mp4'), /renders\/master\.mp4 is 25\.0 MB; the table plays an original of up to 25 MB — hand in the 720p review render/)
})

test('a clip outside the working copy, or not there, is refused without naming where the working copy is', async () => {
  for (const p of ['../secret.mp4', '/abs/secret.mp4', 'renders/link.mp4', 'renders/none.mp4']) {
    await assert.rejects(hand(p), (error) => !error.message.includes(work) && !error.message.includes(outside), p)
  }
})

test('without the session stamp (an older gugu) the agent is told to hand the clip in as a file', async () => {
  await assert.rejects(hand('renders/cut.720p.mp4', { agent: 'user:a' }), /hand the clip in as a file instead/)
})

// A clip handed in for real: the table as gugu.files.open hands it to the program, and the uploads to its chat.
let tools = null
try {
  tools = ffmpegTools()
} catch {}
const noFfmpeg = !tools && 'no ffmpeg here'
const clip = (name, sound) => {
  execFileSync(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x180:rate=10', '-f', 'lavfi', '-i', sound,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(work, 'renders', name)])
  return `renders/${name}`
}
function table() {
  const data = { brief: '', rounds: { r1: { n: 1, track: '片子', kind: '整片', slot: '整片', ask: '', each: 1, agents: ['user:a'], refs: [] } }, cards: {}, feedback: {}, rules: {}, names: {} }
  const uploads = []
  globalThis.gugu = {
    files: {
      open: async () => ({ data, toJSON: () => structuredClone(data), transact: (fn) => fn(), saved: true, onStatus() {}, close() {}, entry: { id: 'table', chat: 'chat-1', name: 't.studio.json' } }),
      upload: async (place, files) => {
        uploads.push({ place, files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })) })
        return files.map((_, i) => ({ id: `item-${uploads.length}-${i}` }))
      },
    },
  }
  return { data, uploads }
}
// submit's own folders only (mkdtemp adds 6 characters): another test file's work folder is not counted.
const clipDirs = () => readdirSync(tmpdir()).filter((name) => /^studio-clip-[A-Za-z0-9]{6}$/.test(name)).length
const shaOf = (p) => createHash('sha256').update(readFileSync(path.join(work, p))).digest('hex')

test('a clip it takes: its cover and strip go to the table\'s chat, and the card keeps them with its check', { skip: noFfmpeg }, async () => {
  const p = clip('voiced.mp4', 'sine=frequency=440:duration=4')
  const { data, uploads } = table()
  const before = clipDirs()
  const answer = await hand(p)
  assert.equal(uploads.length, 1)
  assert.deepEqual(uploads[0].place, { chat: 'chat-1' })
  // Named by the clip and its hash: two cards' voiced.mp4 do not share a name in the group folder.
  const sha8 = shaOf(p).slice(0, 8)
  assert.deepEqual(uploads[0].files.map((f) => [f.name, f.type]), [[`voiced-${sha8}-cover.jpg`, 'image/jpeg'], [`voiced-${sha8}-strip.jpg`, 'image/jpeg']])
  const card = data.cards[answer.card]
  assert.equal(card.video.cover, 'item-1-0')
  assert.equal(card.video.strip, 'item-1-1')
  assert.equal(card.video.sha256, createHash('sha256').update(readFileSync(path.join(work, p))).digest('hex'))
  assert.deepEqual([card.video.width, card.video.height, card.video.at], [320, 180, { session: 's-1', path: p }])
  assert.ok(Math.abs(card.video.seconds - 4) < 0.2)
  assert.ok(card.video.check.lufs > -30)
  assert.deepEqual(answer.check, card.video.check)
  assert.equal(clipDirs(), before, 'the cover and strip made for the call are gone after it')
})

test('a clip nobody can hear is refused before anything reaches the chat or the table', { skip: noFfmpeg }, async () => {
  const p = clip('silent.mp4', 'anullsrc=r=48000:cl=stereo')
  const { data, uploads } = table()
  await assert.rejects(hand(p), /renders\/silent\.mp4 was not handed in: it has no sound .*mux the narration in/)
  assert.deepEqual([uploads, data.cards], [[], {}])
})

test('a card refused for its own reasons (no title) sends no pictures to the chat', { skip: noFfmpeg }, async () => {
  const p = clip('untitled.mp4', 'sine=frequency=440:duration=4')
  const { data, uploads } = table()
  const before = clipDirs()
  await assert.rejects(hand(p, call, ''), /a card needs a title/)
  assert.deepEqual([uploads, data.cards], [[], {}])
  assert.equal(clipDirs(), before)
})

test('a cover that cannot be made: nothing reaches the chat or the table, its folder is gone, and the error names no path', { skip: (noFfmpeg || process.platform === 'win32') && 'needs ffmpeg and a POSIX shell' }, async () => {
  const p = clip('cover-fails.mp4', 'sine=frequency=440:duration=4')
  // An ffmpeg that fails only at the cover (the one call with -ss), as a real one would on a broken file.
  const bin = mkdtempSync(path.join(tmpdir(), 'studio-fake-ffmpeg-'))
  writeFileSync(path.join(bin, 'ffmpeg'), `#!/bin/sh\ncase " $* " in *" -ss "*) echo "${work}/renders/cover-fails.mp4: Invalid data found when processing input" >&2; exit 1;; esac\nexec "${tools.ffmpeg}" "$@"\n`, { mode: 0o755 })
  symlinkSync(tools.ffprobe, path.join(bin, 'ffprobe'))
  const saved = process.env.STUDIO_FFMPEG
  process.env.STUDIO_FFMPEG = path.join(bin, 'ffmpeg')
  try {
    const { data, uploads } = table()
    const before = clipDirs()
    const refused = await hand(p).catch((error) => error)
    assert.match(refused.message, /^renders\/cover-fails\.mp4 was not handed in: making the cover failed on .+: cover-fails\.mp4: Invalid data found when processing input$/)
    assert.ok(!refused.message.includes(work), refused.message)
    assert.deepEqual([uploads, data.cards], [[], {}])
    assert.equal(clipDirs(), before)
  } finally {
    if (saved === undefined) delete process.env.STUDIO_FFMPEG
    else process.env.STUDIO_FFMPEG = saved
    rmSync(bin, { recursive: true, force: true })
  }
})

test("a card's model is the one gugu stamps on the call, never the agent's word; a version without one shows none", async () => {
  const { data } = table()
  const first = await submit.run({ board: 'table', round: 'r1', title: 't', text: 'a', model: 'what it says it is' }, { ...call, model: 'platform:glm-5.3-flash' })
  assert.equal(data.cards[first.card].model, 'platform:glm-5.3-flash')
  await submit.run({ board: 'table', round: 'r1', card: first.card, text: 'b', model: 'what it says it is' }, call)
  assert.equal(data.cards[first.card].model, null)
  assert.equal(data.cards[first.card].versions[1].model, 'platform:glm-5.3-flash')
})

test('every export of tools.js is a tool — gugu serves each one, and anything else keeps the program from starting', async () => {
  const exported = await import('../app/tools.js')
  for (const [name, tool] of Object.entries(exported)) {
    assert.match(name, /^[a-z][a-z_]*$/, `${name}: a tool name`)
    assert.equal(typeof tool?.description, 'string', `${name}: a description`)
    assert.equal(tool.inputSchema?.type, 'object', `${name}: an input schema`)
    assert.equal(typeof tool.run, 'function', `${name}: run`)
  }
})
