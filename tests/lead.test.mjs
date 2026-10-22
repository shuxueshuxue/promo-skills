// 片场 lead: the agent that leads a film opens its rounds with open_round — one at a time, only after the person picked
// (or skipped), within the table's limits, never while the person has taken over. Run: node --test tests/*.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIMITS, addRound, limitsOf, picksSoFar, roundCall, waitingRound } from '../app/model.js'
import { board, open_round } from '../app/tools.js'

const LEAD = 'user:lead'
const [A, B, C, D, E] = ['user:a', 'user:b', 'user:c', 'user:d', 'user:e']

/** The chat as the program sees it: one table file it creates and opens, and the whispers it sends. */
function chat({ failSendTo = [] } = {}) {
  const state = { data: null, created: [], sent: [], opened: [] }
  globalThis.gugu = {
    files: {
      create: async (target, content) => {
        state.created.push(target)
        state.data = structuredClone(content)
        return { id: 'item-table', chat: target.chat, name: target.name }
      },
      open: async (ref) => {
        state.opened.push(ref)
        const { id } = ref
        assert.equal(id, 'item-table')
        const data = state.data
        return { data, toJSON: () => structuredClone(data), transact: (fn) => fn(), saved: true, onStatus() {}, close() {}, entry: { id, chat: 'chat-1', name: 't.studio.json' } }
      },
    },
    send: async (to, text, where) => {
      if (failSendTo.includes(to)) throw Object.assign(new Error('not in this chat'), { code: 'invalid' })
      if (where?.about != null) throw Object.assign(new Error('about is gone: name the file in refs'), { code: 'invalid' })
      const file = where?.refs?.[0]?.file
      assert.equal(file?.chat, 'chat-1')
      state.sent.push({ to, text, file: file?.id })
    },
  }
  return state
}
const pick = (state, card) => {
  state.data.feedback[`f-${card}`] = { card, verdict: 'pick', who: 'user:person', ts: new Date().toISOString() }
}
const hand = (state, card, round) => {
  state.data.cards[card] = { round, by: A, title: card, version: 1, at: new Date().toISOString() }
}
const first = { chat: 'chat-1', title: '咕咕 30 秒', brief: '给咕咕做条 30 秒的片子', round: { kind: '叙事', slot: '叙事主线', agents: [A, B], ask: '一句话讲法 + 六拍' }, plan: [{ kind: '分镜', slot: '分镜' }, { kind: '配音', slot: '挑声音' }, { kind: '整片', slot: '整片' }] }

test('the first call makes the table in the chat with the caller as its lead, opens round 1 and wakes its writers', async () => {
  const state = chat()
  const answer = await open_round.run(first, { agent: LEAD })
  assert.deepEqual(state.created, [{ chat: 'chat-1', name: '咕咕 30 秒.studio.json' }])
  // Opened where it was made, as the lead — not by a bare id, which opens as the person (review r4).
  assert.deepEqual(state.opened, [{ chat: 'chat-1', id: 'item-table' }])
  assert.equal(state.data.lead, LEAD)
  assert.deepEqual(state.data.brief, { $text: '给咕咕做条 30 秒的片子' })
  assert.deepEqual([answer.board, answer.n, answer.told], ['item-table', 1, [A, B]])
  const round = state.data.rounds[answer.round]
  assert.deepEqual([round.kind, round.slot, round.track, round.by, round.each, round.refs], ['叙事', '叙事主线', '片子', LEAD, 1, []])
  assert.deepEqual(state.sent.map((s) => [s.to, s.file]), [[A, 'item-table'], [B, 'item-table']])
  assert.equal(state.sent[0].text, roundCall({ n: 1, slot: '叙事主线', kind: '叙事', each: 1 }))
  assert.deepEqual(state.data.plan.map((s) => s.slot), ['分镜', '挑声音', '整片'])
})

test('no next round until the person picks (or skips) — then it builds on the picks and the plan moves on', async () => {
  const state = chat()
  const one = await open_round.run(first, { agent: LEAD })
  const next = { board: 'item-table', round: { kind: '分镜', slot: '分镜', agents: [B, C] } }
  await assert.rejects(open_round.run(next, { agent: LEAD }), /round 1 \(叙事主线\) has no pick yet: the person picks, not you/)
  hand(state, 'c-story', one.round)
  pick(state, 'c-story')
  const two = await open_round.run(next, { agent: LEAD })
  assert.equal(two.n, 2)
  assert.deepEqual(state.data.rounds[two.round].refs, ['c-story'])
  assert.deepEqual(two.plan.map((s) => s.slot), ['挑声音', '整片'])
  // A round the person skips is no longer waited on.
  state.data.rounds[two.round].skipped = true
  assert.equal(waitingRound(state.data), null)
  assert.equal((await open_round.run({ board: 'item-table', round: { kind: '配音', slot: '挑声音', agents: [A] } }, { agent: LEAD })).n, 3)
})

test('the person has the table: while paused nothing opens; another agent is a writer, not the lead', async () => {
  const state = chat()
  const one = await open_round.run(first, { agent: LEAD })
  hand(state, 'c1', one.round)
  pick(state, 'c1')
  const next = { board: 'item-table', round: { kind: '分镜', slot: '分镜', agents: [A] } }
  state.data.paused = true
  await assert.rejects(open_round.run(next, { agent: LEAD }), /the person has taken this table over: open nothing/)
  state.data.paused = false
  await assert.rejects(open_round.run(next, { agent: A }), /another agent leads this table: you are a writer here/)
})

test('within the table\'s limits: writers a round, cards each, rounds a table — the person\'s own over the defaults', async () => {
  const state = chat()
  await assert.rejects(open_round.run({ ...first, round: { ...first.round, agents: [A, B, C, D, E] } }, { agent: LEAD }), /at most 4 writers a round \(you named 5\)/)
  await assert.rejects(open_round.run({ ...first, round: { ...first.round, each: 4 } }, { agent: LEAD }), /at most 3 cards each/)
  await assert.rejects(open_round.run({ ...first, round: { ...first.round, agents: [A, LEAD] } }, { agent: LEAD }), /not you — the lead plans and opens rounds/)
  await assert.rejects(open_round.run({ ...first, round: { ...first.round, agents: [] } }, { agent: LEAD }), /round\.agents: the writers/)
  // A refused first call makes nothing (review r3: four refusals left four empty tables of one name), whispers no one.
  assert.deepEqual([state.created.length, state.sent.length], [0, 0])
  const one = await open_round.run(first, { agent: LEAD })
  state.data.limits = { rounds: 1 }
  hand(state, 'c1', one.round)
  pick(state, 'c1')
  await assert.rejects(open_round.run({ board: 'item-table', round: { kind: '分镜', slot: '分镜', agents: [A] } }, { agent: LEAD }), /this table has had its 1 rounds: ask the person in one line whether to go on/)
  assert.deepEqual(limitsOf(state.data), { ...LIMITS, rounds: 1 })
})

test('the first call needs the chat, a title and the brief; a writer it cannot reach is said, the others still woken', async () => {
  chat()
  await assert.rejects(open_round.run({ round: first.round }, { agent: LEAD }), /the first call makes the table: give chat .*, title .* and brief/)
  const state = chat({ failSendTo: [B] })
  const answer = await open_round.run(first, { agent: LEAD })
  assert.deepEqual(answer.told, [A])
  assert.deepEqual(answer.notTold, [{ writer: B, why: 'not in this chat' }])
  assert.equal(state.sent.length, 1)
})

test('a plan given with a round is the rounds after it, as given; without one, the round leaves the plan only when it is its first step (review r3)', async () => {
  const opened = async (plan, round, given) => {
    const state = chat()
    const one = await open_round.run({ ...first, plan }, { agent: LEAD })
    hand(state, 'c1', one.round)
    pick(state, 'c1')
    const two = await open_round.run({ board: 'item-table', round: { agents: [A], ...round }, ...(given ? { plan: given } : {}) }, { agent: LEAD })
    return two.plan.map((s) => `${s.kind}·${s.slot}`)
  }
  const start = { kind: '分镜', slot: '开头' }
  // The review's reading: 分镜·开头 opened with a plan of 分镜·结尾 and 整片 kept 整片 alone — 结尾 was swallowed.
  assert.deepEqual(await opened([], start, [{ kind: '分镜', slot: '结尾' }, { kind: '整片', slot: '整片' }]), ['分镜·结尾', '整片·整片'])
  // No plan given: the planned 分镜·结尾 is not this round (the same kind, another slot), so it stays.
  assert.deepEqual(await opened([{ kind: '分镜', slot: '结尾' }, { kind: '整片', slot: '整片' }], start), ['分镜·结尾', '整片·整片'])
  // No plan given, and this round is the plan's first step: it leaves.
  assert.deepEqual(await opened([{ kind: '分镜', slot: '开头' }, { kind: '整片', slot: '整片' }], start), ['整片·整片'])
})

test('board tells each writer its own folder for the table: writers sharing a working copy write no file twice (trial 10-12)', async () => {
  chat()
  await open_round.run(first, { agent: LEAD })
  const [a, b] = [await board.run({ board: 'item-table' }, { agent: A }), await board.run({ board: 'item-table' }, { agent: B })]
  assert.deepEqual([a.yourFolder, b.yourFolder], ['studio/t/a', 'studio/t/b'])
})

test('the chat of the first call is a gugu-chat: gugu hands it over as the caller\'s own, also by its number (review r3)', () => {
  const { properties } = open_round.inputSchema
  assert.equal(properties.chat.format, 'gugu-chat')
  assert.equal(properties.board.format, 'gugu-file')
})

test('a chat that is not a string is refused before anything is made — a number is not handed over by every gugu (review r4)', async () => {
  const state = chat()
  await assert.rejects(open_round.run({ ...first, chat: 211386 }, { agent: LEAD }), /chat: this chat's id or its number, as a string/)
  await assert.rejects(open_round.run({ ...first, chat: { id: 'chat-1' } }, { agent: LEAD }), /as a string/)
  assert.deepEqual([state.created.length, state.sent.length], [0, 0])
})

test('a plan that is not a list of { kind, slot } is refused before anything is made or written — on the first call and later (review r5)', async () => {
  const BAD = ['分镜, 整片', { kind: '分镜', slot: '分镜' }, [null], ['分镜'], [{ slot: '开头' }], [{ kind: '不存在', slot: 'x' }], [{ kind: '整片' }, 7]]
  const SHAPE = /plan: the rounds you mean to open after this one, as a list of \{ kind, slot \} — kind one of /
  const state = chat()
  for (const plan of BAD) await assert.rejects(open_round.run({ ...first, plan }, { agent: LEAD }), SHAPE)
  assert.deepEqual([state.created.length, state.sent.length], [0, 0])
  // Later, round 1 picked: each bad plan leaves the table as it was — no round 2 on it, nobody whispered, the plan kept.
  const one = await open_round.run(first, { agent: LEAD })
  hand(state, 'c1', one.round)
  pick(state, 'c1')
  const before = structuredClone(state.data)
  const sent = state.sent.length
  const next = { board: 'item-table', round: { kind: '分镜', slot: '分镜', agents: [A] } }
  for (const plan of BAD) await assert.rejects(open_round.run({ ...next, plan }, { agent: LEAD }), SHAPE)
  assert.deepEqual(state.data, before)
  assert.equal(state.sent.length, sent)
  // A round's writers or refs that are not lists: said so, nothing written either.
  await assert.rejects(open_round.run({ ...next, round: { ...next.round, agents: A } }, { agent: LEAD }), /round\.agents: the writers, a list/)
  await assert.rejects(open_round.run({ ...next, round: { ...next.round, refs: 'c1' } }, { agent: LEAD }), /round\.refs: the cards to build on, a list/)
  assert.deepEqual(state.data, before)
  // No plan (absent or null) is no plan; a good one opens the round.
  assert.equal((await open_round.run({ ...next, plan: null }, { agent: LEAD })).n, 2)
})

test('the plan after a round: as given (slots trimmed, even when it names this round); else the first step that is this round leaves it, wherever it is (review r4)', async () => {
  const { planAfter } = await import('../app/model.js')
  const of = (plan) => plan.map((s) => `${s.kind}·${s.slot}`)
  const plan = [{ kind: '分镜', slot: '开头' }, { kind: '整片', slot: '整片' }]
  // Q3: a plan given is kept as given, this round in it or not.
  assert.deepEqual(of(planAfter(plan, [{ kind: '分镜', slot: '开头' }, { kind: '整片', slot: ' 整片 ' }], '分镜', '开头')), ['分镜·开头', '整片·整片'])
  assert.deepEqual(planAfter(plan, [], '分镜', '开头'), [])
  // Opened out of order: 整片 leaves, 开头 stays.
  assert.deepEqual(of(planAfter(plan, undefined, '整片', '整片')), ['分镜·开头'])
  // A planned slot written with spaces is the same step.
  assert.deepEqual(of(planAfter([{ kind: '分镜', slot: ' 开头 ' }, { kind: '整片', slot: '整片' }], undefined, '分镜', '开头')), ['整片·整片'])
  // No slot on either side: the kind is the slot.
  assert.deepEqual(of(planAfter([{ kind: '分镜' }, { kind: '整片' }], undefined, '分镜', '分镜')), ['整片·整片'])
  // A round outside the plan leaves it as it was.
  assert.deepEqual(of(planAfter(plan, undefined, '分镜', '加一轮')), ['分镜·开头', '整片·整片'])
  // A step on the table that is not one (the file edited by hand) is dropped, not thrown on (review r5).
  assert.deepEqual(of(planAfter([null, 'x', { kind: '整片', slot: '整片' }], undefined, '分镜', '开头')), ['整片·整片'])
  // Through open_round: a plan given whose first step is this very round stays as given.
  const state = chat()
  const one = await open_round.run({ ...first, plan: [] }, { agent: LEAD })
  hand(state, 'c1', one.round)
  pick(state, 'c1')
  const two = await open_round.run({ board: 'item-table', round: { kind: '分镜', slot: '开头', agents: [A] }, plan }, { agent: LEAD })
  assert.deepEqual(of(two.plan), ['分镜·开头', '整片·整片'])
})

test('rounds are numbered in the order they are put on the table, whoever opens them', () => {
  const data = { rounds: {}, cards: {}, feedback: {} }
  assert.equal(addRound(data, { id: 'r1', track: '片子', kind: '叙事', slot: '叙事', each: 1, agents: [A] }, 'user:person', 't'), 1)
  assert.equal(addRound(data, { id: 'r2', track: '片子', kind: '分镜', slot: '分镜', each: 1, agents: [A] }, LEAD, 't'), 2)
  assert.deepEqual([data.rounds.r2.by, data.rounds.r2.refs, data.rounds.r2.ask], [LEAD, [], ''])
  assert.deepEqual(waitingRound(data), { id: 'r1', n: 1, slot: '叙事' })
  data.cards.c1 = { round: 'r1' }
  data.feedback.f1 = { card: 'c1', verdict: 'pick', ts: 't' }
  assert.deepEqual(picksSoFar(data), ['c1'])
  assert.deepEqual(waitingRound(data), { id: 'r2', n: 2, slot: '分镜' })
})
