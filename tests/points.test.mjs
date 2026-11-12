// 片场 points in a clip: a note with a time, read by the page and by agents (points), marked handled (resolve).
// Run: node --test tests/*.mjs
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { normalizeTable, parseTimecode, pointOn, timecode, timedNotes } from '../app/model.js'
import { board, note, points, resolve } from '../app/tools.js'

test('a time reads back as it was typed, to a tenth', () => {
  assert.deepEqual([0, 5, 65, 65.4, 3725].map(timecode), ['0:00', '0:05', '1:05', '1:05.4', '1:02:05'])
  assert.deepEqual(['65', '1:05', '1:05.4', '0:01:05', ' 2:00 '].map(parseTimecode), [65, 65, 65.4, 65, 120])
  for (const bad of ['', 'abc', '1:', ':5', '-3', '1:2:3:4', '1.5:00', '1:5', '1:5.5', '0:1:05']) assert.equal(parseTimecode(bad), null, bad)
})

let data
beforeEach(() => {
  data = {
    brief: '', rounds: { r1: { n: 1, track: '片子', kind: '整片', slot: '整片', agents: ['user:w'], refs: [] } },
    cards: { c1: { round: 'r1', by: 'user:w', title: 'cut', version: 2, at: '2026-11-12T01:00:00Z', video: { seconds: 90, cover: 'i1', at: { session: 's', path: 'p' } } } },
    feedback: {
      f1: { card: 'c1', verdict: 'note', comment: 'whole card', who: 'user:p', ts: '2026-11-12T02:00:00Z' },
      f2: { card: 'c1', verdict: 'note', comment: 'subtitle typo', who: 'user:q', ts: '2026-11-12T02:01:00Z', seconds: 42.5, tag: 'subtitle', version: 2 },
      f3: { card: 'c1', verdict: 'reject', comment: 'cold open drags', who: 'user:p', ts: '2026-11-12T02:02:00Z', seconds: 3, tag: 'pace', version: 1 },
      f4: { card: 'c1', verdict: 'pick', who: 'user:p', ts: '2026-11-12T02:03:00Z', seconds: 1 },
    },
    rules: {}, names: {},
  }
  globalThis.gugu = { files: { open: async () => ({ data, toJSON: () => structuredClone(data), transact: (fn) => fn(), saved: true, onStatus() {}, close() {}, entry: { id: 't', name: 't.studio.json' } }) } }
})

test('points are the notes and rejects with a time, in the clip order; a pick is never one', () => {
  assert.deepEqual(timedNotes(data, 'c1').map((p) => p.id), ['f3', 'f2'])
})

test('an agent lists the points first, then the whole-card notes; open: true leaves out what is handled', async () => {
  const all = await points.run({ board: 't', card: 'c1' }, { agent: 'user:w' })
  assert.deepEqual(all.notes.map((n) => [n.id, n.timecode ?? null, n.tag ?? null, n.version ?? null]), [['f3', '0:03', 'pace', 1], ['f2', '0:42.5', 'subtitle', 2], ['f1', null, null, null]])
  assert.equal(all.clipSeconds, 90)
  await resolve.run({ board: 't', note: 'f2', comment: 'fixed the typo in v3' }, { agent: 'user:w' })
  assert.deepEqual(data.feedback.f2.done.comment, 'fixed the typo in v3')
  assert.equal(data.feedback.f2.done.who, 'user:w')
  const open = await points.run({ board: 't', card: 'c1', open: true }, { agent: 'user:w' })
  assert.deepEqual(open.notes.map((n) => n.id), ['f3', 'f1'])
  // A person unticking 已处理 writes null: it is open again.
  data.feedback.f2.done = null
  assert.deepEqual((await points.run({ board: 't', card: 'c1', open: true }, {})).notes.map((n) => n.id), ['f3', 'f2', 'f1'])
})

test('resolve needs a line, a real note, and is never a pick', async () => {
  await assert.rejects(resolve.run({ board: 't', note: 'f2', comment: ' ' }, { agent: 'user:w' }), /one line/)
  await assert.rejects(resolve.run({ board: 't', note: 'nope', comment: 'x' }, { agent: 'user:w' }), /no note nope/)
  await assert.rejects(resolve.run({ board: 't', note: 'f4', comment: 'x' }, { agent: 'user:w' }), /no note f4/)
})

test('an agent note can carry a point; board shows it and the open count', async () => {
  await note.run({ board: 't', card: 'c1', comment: 'logo is blurry', seconds: 12.34, tag: 'visual' }, { agent: 'user:r' })
  const added = Object.values(data.feedback).find((e) => e.comment === 'logo is blurry')
  assert.deepEqual([added.seconds, added.tag, added.version], [12.3, 'visual', 2])
  await assert.rejects(note.run({ board: 't', card: 'c1', comment: 'x', seconds: 1, tag: '画面' }, { agent: 'user:r' }), /tag: one of/)
  await assert.rejects(note.run({ board: 't', card: 'c1', comment: 'x', seconds: -1 }, { agent: 'user:r' }), /seconds/)
  // The same rule as the page's: no point past the clip's end.
  await assert.rejects(note.run({ board: 't', card: 'c1', comment: 'x', seconds: 9999 }, { agent: 'user:r' }), /1:30 long/)
  const seen = await board.run({ board: 't' }, { agent: 'user:w' })
  assert.equal(seen.cards[0].openPoints, 3)
  assert.deepEqual(seen.feedbackOnYours.find((e) => e.id === 'f2').timecode, '0:42.5')
})

test('one maker of a point: rounds to a tenth, takes the card version, refuses past the end with a code', () => {
  const card = data.cards.c1
  assert.deepEqual(pointOn(card, 12.34, 'voice'), { seconds: 12.3, version: 2, tag: 'voice' })
  assert.deepEqual(pointOn({ files: ['i'] }, 500), { seconds: 500, version: 1 }) // a file clip whose length is not known yet
  assert.throws(() => pointOn(card, 91), (e) => e.code === 'past-end')
  assert.throws(() => pointOn({ files: ['i'] }, 20, undefined, 10), (e) => e.code === 'past-end')
  assert.throws(() => pointOn(card, NaN), (e) => e.code === 'seconds')
  assert.throws(() => pointOn(card, 1, 'toString'), (e) => e.code === 'tag')
})

test('a tag the first 0.10.0 build stored as its word reads back as its key, once', () => {
  data.feedback.f2.tag = '字幕'
  data.feedback.f3.tag = '节奏'
  data.spend = {}
  assert.equal(normalizeTable(data), 2)
  assert.deepEqual([data.feedback.f2.tag, data.feedback.f3.tag], ['subtitle', 'pace'])
  assert.equal(normalizeTable(data), 0)
})

test("resolve leaves someone else's handling as it is; the same agent may say it again", async () => {
  await resolve.run({ board: 't', note: 'f2', comment: 'fixed in v3' }, { agent: 'user:w' })
  await assert.rejects(resolve.run({ board: 't', note: 'f2', comment: 'mine' }, { agent: 'user:r' }), /already handled by user:w: fixed in v3/)
  await resolve.run({ board: 't', note: 'f2', comment: 'fixed in v4' }, { agent: 'user:w' })
  assert.equal(data.feedback.f2.done.comment, 'fixed in v4')
})
