// 抽卡台 model: the table made whole on open, and a card's history. Run: node --test tests/*.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eventsOf, normalizeTable, pickOfRound, tracksInOrder } from '../app/model.js'

/** A table as 0.2.0 wrote it: rounds without a line, a card revised before versions were kept. */
const before030 = () => ({
  brief: { $text: 'a promo' },
  rounds: {
    r1: { n: 1, kind: '叙事', slot: '叙事主线', agents: ['user:a'], refs: [], at: '2026-10-07T12:00:00Z' },
    r2: { n: 2, kind: '宣传稿', slot: '标题', agents: ['user:a'], refs: ['c1'], at: '2026-10-07T13:00:00Z' },
    r3: { n: 3, kind: '分镜', slot: '分镜', agents: ['user:a'], refs: ['c1'], at: '2026-10-07T14:00:00Z', track: '画面' },
  },
  cards: {
    c1: { round: 'r1', by: 'user:a', title: 'one', text: 'v1', version: 1, at: '2026-10-07T12:10:00Z' },
    c2: { round: 'r2', by: 'user:a', title: 'two', text: 'v2 text', version: 2, at: '2026-10-07T13:10:00Z', updatedAt: '2026-10-07T13:40:00Z' },
  },
  feedback: {
    f1: { card: 'c1', verdict: 'pick', who: 'user:p', ts: '2026-10-07T12:30:00Z' },
    f2: { card: 'c2', verdict: 'reject', comment: 'shorter', who: 'user:p', ts: '2026-10-07T13:20:00Z' },
  },
})

test('normalizeTable fills only what is missing, and a second run changes nothing', () => {
  const data = before030()
  assert.ok(normalizeTable(data) > 0)
  const once = structuredClone(data)
  assert.equal(normalizeTable(data), 0)
  assert.deepEqual(data, once)
})

test('a line someone set is kept; a missing one is guessed once from the kind', () => {
  const data = before030()
  normalizeTable(data)
  assert.equal(data.rounds.r1.track, '片子')
  assert.equal(data.rounds.r2.track, '文字')
  assert.equal(data.rounds.r3.track, '画面')
  // Once written, the line is the line: changing the kind afterwards does not move the round.
  data.rounds.r2.kind = '叙事'
  normalizeTable(data)
  assert.equal(data.rounds.r2.track, '文字')
})

test('missing maps are made; cards are left as they are (versions is written by the submit that revises a card)', () => {
  const data = { rounds: { r1: { n: 1, kind: '叙事' } }, cards: { c1: { round: 'r1', version: 1 } } }
  normalizeTable(data)
  for (const key of ['feedback', 'rules', 'names']) assert.deepEqual(data[key], {})
  assert.deepEqual(data.cards.c1, { round: 'r1', version: 1 })
})

test('tracksInOrder: the first line started is the trunk; rounds in order within a line', () => {
  const data = before030()
  normalizeTable(data)
  assert.deepEqual(tracksInOrder(data), [{ name: '片子', rounds: ['r1'] }, { name: '文字', rounds: ['r2'] }, { name: '画面', rounds: ['r3'] }])
})

test('pickOfRound is the latest pick among the round\'s own cards', () => {
  const data = before030()
  normalizeTable(data)
  assert.equal(pickOfRound(data, 'r1'), 'c1')
  assert.equal(pickOfRound(data, 'r2'), null)
})

test('pickOfRound: a pick sent back is no pick until the new version is in (the judgement board gives agents)', () => {
  const data = before030()
  normalizeTable(data)
  data.feedback.f3 = { card: 'c1', verdict: 'reject', comment: 'again', who: 'user:p', ts: '2026-10-07T12:40:00Z' }
  assert.equal(pickOfRound(data, 'r1'), null)
  Object.assign(data.cards.c1, { version: 2, updatedAt: '2026-10-07T12:50:00Z' })
  assert.equal(pickOfRound(data, 'r1'), 'c1')
})

test('eventsOf: a version overwritten before 0.3.0 is marked lost; a kept one carries its text', () => {
  const data = before030()
  normalizeTable(data)
  const old = eventsOf(data, 'c2')
  assert.deepEqual(old.map((e) => [e.kind, e.version ?? null, Boolean(e.lost)]), [['version', 1, true], ['reject', null, false], ['version', 2, false]])
  // A revision made from 0.3.0 on keeps the replaced text (what submit writes).
  data.cards.c2.versions = { ...(data.cards.c2.versions ?? {}), 2: { title: 'two', text: 'v2 text', at: '2026-10-07T13:40:00Z' } }
  Object.assign(data.cards.c2, { text: 'v3 text', version: 3, updatedAt: '2026-10-07T14:00:00Z' })
  const kept = eventsOf(data, 'c2').filter((e) => e.kind === 'version')
  assert.deepEqual(kept.map((e) => [e.version, e.saved?.text ?? null, Boolean(e.lost)]), [[1, null, true], [2, 'v2 text', false], [3, 'v3 text', false]])
})
