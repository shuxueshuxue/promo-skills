import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { submit } from '../app/tools.js'

const fixtures = []
afterEach(() => {
  delete globalThis.gugu
  for (const dir of fixtures.splice(0)) {
    console.log(`fixture_cleanup=${dir}`)
    assert.equal(path.dirname(dir), tmpdir(), 'cleanup stays under this run temporary directory')
    assert.ok(path.basename(dir).startsWith('studio-submit-retry-'))
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixture({ acknowledged = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-submit-retry-'))
  fixtures.push(dir)
  const file = path.join(dir, 'table.json')
  const round = { n: 1, track: 'film', kind: '整片', slot: '整片', agents: ['user:a', 'user:b'], each: 3 }
  writeFileSync(file, JSON.stringify({ brief: '', rounds: { r1: round, r2: { ...round, n: 2 } }, cards: {}, feedback: {}, rules: {}, names: {} }))
  let written
  const firstWrite = new Promise((resolve) => { written = resolve })
  const read = () => JSON.parse(readFileSync(file, 'utf8'))
  globalThis.gugu = { files: {
    async open() {
      const data = read()
      const persist = () => writeFileSync(file, JSON.stringify(data))
      const cards = new Proxy(data.cards, { set(target, key, value) {
        target[key] = value
        persist()
        written()
        return true
      } })
      return {
        data: { ...data, cards },
        toJSON: () => structuredClone(data),
        transact(fn) { fn(); persist() },
        get saved() { return acknowledged },
        onStatus() { return () => {} },
        close() {},
        entry: { id: 'table', chat: 'chat-1', name: 'retry.studio.json' },
      }
    },
    async upload() { throw new Error('unexpected upload') },
  } }
  return { read, firstWrite, acknowledge() { acknowledged = true } }
}

const args = { board: 'table', round: 'r1', submission: 'narrative-option-1', title: 'one proposal', text: 'the same proposal' }
const caller = { agent: 'user:a' }

test('a persisted write whose save acknowledgement times out is one card after retry', async () => {
  const f = fixture({ acknowledged: false })
  // Use the App's real ten-second save deadline, not a mocked clock or a timing assertion.
  const timedOut = assert.rejects(submit.run(args, caller), /the card table did not save within 10 s/)
  await f.firstWrite
  assert.equal(Object.keys(f.read().cards).length, 1, 'positive control: the first card reached persistent storage')
  console.log('persisted_before_timeout=1')
  const originalId = Object.keys(f.read().cards)[0]
  await timedOut
  f.acknowledge()
  const retry = await submit.run(args, caller)
  assert.equal(Object.keys(f.read().cards).length, 1, 'retry must keep one persisted card')
  assert.equal(retry.card, originalId)
  assert.equal(retry.version, 1)
  assert.equal(Object.keys(f.read().cards).length, 1)
})

test('a new card without a stable key is refused without writing; different keys allow identical proposals', async () => {
  const f = fixture()
  const { submission, ...unkeyed } = args
  await assert.rejects(submit.run(unkeyed, caller), /new card needs submission/)
  assert.deepEqual(f.read().cards, {})
  const a = await submit.run(args, caller)
  const b = await submit.run({ ...args, submission: 'narrative-option-2' }, caller)
  assert.notEqual(a.card, b.card)
  assert.equal(Object.keys(f.read().cards).length, 2)
})

test('the key is scoped to the trusted caller and round, not a model-supplied author', async () => {
  const f = fixture()
  const a = await submit.run({ ...args, agent: 'user:b' }, caller)
  const b = await submit.run(args, { agent: 'user:b' })
  const c = await submit.run({ ...args, round: 'r2' }, caller)
  assert.equal(new Set([a.card, b.card, c.card]).size, 3)
  assert.equal(f.read().cards[a.card].by, 'user:a')
})

test('reusing a key with different input reports a conflict and keeps the original', async () => {
  const f = fixture()
  const first = await submit.run(args, caller)
  await assert.rejects(submit.run({ ...args, text: 'a different proposal' }, caller), /already used with different arguments/)
  assert.equal(f.read().cards[first.card].text, args.text)
  assert.equal(Object.keys(f.read().cards).length, 1)
})

test('retrying with recomputed cost keeps the original proposal and cost', async () => {
  const f = fixture()
  const first = await submit.run({ ...args, cost: { usd: 1, seconds: 10, tokens: 100 } }, caller)
  const retry = await submit.run({ ...args, cost: { usd: 2, seconds: 20, tokens: 200 } }, caller)
  assert.equal(retry.card, first.card)
  assert.deepEqual(f.read().cards[first.card].cost, { usd: 1, seconds: 10, tokens: 100 })
  assert.equal(Object.keys(f.read().cards).length, 1)
})

test('a late creation retry preserves a later deliberate revision and its history', async () => {
  const f = fixture()
  const first = await submit.run(args, caller)
  const revised = await submit.run({ board: 'table', round: 'r1', card: first.card, text: 'a deliberate revision' }, caller)
  assert.equal(revised.version, 2)
  assert.equal(revised.revised, true)
  const retry = await submit.run(args, caller)
  assert.equal(retry.card, first.card)
  assert.equal(retry.version, 2)
  const card = f.read().cards[first.card]
  assert.equal(card.version, 2)
  assert.equal(card.text, 'a deliberate revision')
  assert.equal(card.versions[1].text, args.text)
  assert.equal(Object.keys(f.read().cards).length, 1)
})
