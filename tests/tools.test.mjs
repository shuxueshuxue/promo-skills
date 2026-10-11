// 抽卡台 tools: what submit refuses about a clip before it touches the table. Run: node --test tests/*.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { submit } from '../app/tools.js'

const work = mkdtempSync(path.join(tmpdir(), 'chouka-tools-'))
const outside = mkdtempSync(path.join(tmpdir(), 'chouka-outside-'))
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
const video = (p) => ({ path: p, cover: 'cover-id', strip: 'strip-id' })
const hand = (p, stamp = call) => submit.run({ board: 'table', round: 'r1', title: 't', video: video(p) }, stamp)

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
