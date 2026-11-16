// 片场 projects (0.11.0): a chat's tables are its projects; an uploaded video is a 素材 card of no round, which points,
// notes and statuses take as any card; new_project makes an empty table an agent can lead later. Run: node --test tests/*.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MATERIAL, addRound, isMaterial, materialCard, materialFolder, materialsOf, newTable, normalizeTable, openPoints, pickOfRound, pointOn, projectFacts, projectName, statusOf, tableFileName, waitingRound } from '../app/model.js'
import { new_project, open_round } from '../app/tools.js'

const PERSON = 'user:person'
const at = (m) => `2026-11-16T0${m}:00:00Z`

test('a project is one .studio.json: named after its title (no path signs), and read back by its name', () => {
  assert.equal(tableFileName(' 宣传片 / 第二版 '), '宣传片   第二版.studio.json')
  assert.equal(projectName('宣传片.studio.json'), '宣传片')
  assert.equal(materialFolder('a/b'), '片场/a b')
})

test('a table from before 0.11.0 is a project as it is: normalizeTable adds nothing to a whole one, facts read its rounds and pick', () => {
  const data = newTable({ brief: '宣传片', lead: 'user:lead' })
  assert.equal(normalizeTable(data), 0)
  addRound(data, { id: 'r1', track: '片子', kind: '整片', slot: '整片', each: 1, agents: ['user:a'] }, 'user:lead', at(1))
  data.cards.c1 = { round: 'r1', kind: '整片', by: 'user:a', title: '整片', files: ['cover-1'], version: 5, at: at(1) }
  data.feedback.f1 = { card: 'c1', verdict: 'pick', who: PERSON, ts: at(2) }
  data.feedback.f2 = { card: 'c1', verdict: 'note', comment: '黑了半秒', who: PERSON, ts: at(3), ...pointOn(data.cards.c1, 2, 'visual', 90) }
  assert.deepEqual(projectFacts(data), { rounds: 1, cards: 1, materials: 0, openPoints: 1, picked: { title: '整片', kind: '整片', version: 5 }, cover: 'cover-1' })
})

test('an uploaded video is a 素材 card of no round: it takes points, is never a round\'s pick and keeps the lead waiting on nothing', () => {
  const data = newTable({ brief: '' })
  data.cards.m1 = materialCard({ id: 'item-v1', name: '片头-v2.mp4' }, PERSON, at(1))
  data.cards.m2 = materialCard({ id: 'item-v2', name: '片尾.mp4' }, PERSON, at(2))
  assert.deepEqual(materialsOf(data).map(([id]) => id), ['m1', 'm2'])
  assert.ok(isMaterial(data.cards.m1))
  assert.deepEqual([data.cards.m1.kind, data.cards.m1.round, data.cards.m1.files, data.cards.m1.title], [MATERIAL, null, ['item-v1'], '片头-v2.mp4'])
  data.feedback.f1 = { card: 'm1', verdict: 'note', comment: '字幕压到按钮', who: PERSON, ts: at(3), ...pointOn(data.cards.m1, 7.44, 'subtitle', 15) }
  assert.equal(openPoints(data, 'm1').length, 1)
  assert.equal(openPoints(data, 'm2').length, 0)
  assert.equal(statusOf(data, 'm1').label, '有批注')
  assert.equal(waitingRound(data), null)
  const facts = projectFacts(data)
  assert.deepEqual([facts.rounds, facts.cards, facts.materials, facts.openPoints, facts.cover], [0, 0, 2, 1, 'item-v2'])
  // A round's cards are its own: materials are in none.
  addRound(data, { id: 'r1', track: '片子', kind: '整片', slot: '整片', each: 1, agents: ['user:a'] }, PERSON, at(4))
  assert.equal(pickOfRound(data, 'r1'), null)
})

/** The chat as the program sees it: tables it creates and opens by id. */
function chat() {
  const state = { files: new Map(), created: [] }
  globalThis.gugu = {
    files: {
      create: async (target, content) => {
        const id = `item-${state.files.size + 1}`
        state.created.push(target)
        state.files.set(id, structuredClone(content))
        return { id, chat: target.chat, name: target.name }
      },
      open: async ({ id }) => {
        const data = state.files.get(id)
        assert.ok(data, `no file ${id}`)
        return { data, toJSON: () => structuredClone(data), transact: (fn) => fn(), saved: true, onStatus() {}, close() {}, entry: { id, chat: 'chat-1', name: 'x.studio.json' } }
      },
    },
    dispatch: async () => {},
  }
  return state
}

test('new_project makes an empty table in the chat — no round, no lead — and an agent can lead it later with open_round', async () => {
  const state = chat()
  const made = await new_project.run({ chat: 'chat-1', title: '新人上手教程', brief: '一条 2 分钟的上手教程' }, { agent: 'user:codex' })
  assert.deepEqual(state.created, [{ chat: 'chat-1', name: '新人上手教程.studio.json' }])
  assert.equal(made.board, 'item-1')
  const data = state.files.get('item-1')
  assert.deepEqual(data, newTable({ brief: '一条 2 分钟的上手教程' }))
  assert.equal(data.lead, undefined)
  const opened = await open_round.run({ board: 'item-1', round: { kind: '叙事', slot: '讲法', agents: ['user:a'] } }, { agent: 'user:lead' })
  assert.equal(opened.n, 1)
  assert.equal(state.files.get('item-1').lead, 'user:lead')
})

test('new_project refuses what would make a nameless or briefless table, and a caller that is not an agent', async () => {
  const state = chat()
  await assert.rejects(new_project.run({ chat: 'chat-1', title: ' ', brief: 'x' }, { agent: 'user:codex' }), /title/)
  await assert.rejects(new_project.run({ chat: 'chat-1', title: 'x', brief: '' }, { agent: 'user:codex' }), /brief/)
  await assert.rejects(new_project.run({ chat: 211386, title: 'x', brief: 'y' }, { agent: 'user:codex' }), /chat/)
  await assert.rejects(new_project.run({ chat: 'chat-1', title: 'x', brief: 'y' }, {}), /agents/)
  assert.deepEqual(state.created, [])
})
