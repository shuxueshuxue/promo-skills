// 片场 model: the table made whole on open, and a card's history. Run: node --test tests/*.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { answered, cardClass, checkLine, eventsOf, spendOf, feedbackOf, normalizeTable, pickOfRound, sentBack, statusOf, tracksInOrder } from '../app/model.js'

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

test('a note after a reject does not undo it: still sent back, still being reworked', () => {
  const data = before030()
  normalizeTable(data)
  data.feedback.f3 = { card: 'c1', verdict: 'reject', comment: 'again', who: 'user:p', ts: '2026-10-07T12:40:00Z' }
  data.feedback.f4 = { card: 'c1', verdict: 'note', comment: 'nice colours', who: 'user:agent', ts: '2026-10-07T12:45:00Z' }
  assert.equal(sentBack(data, 'c1'), true)
  assert.equal(pickOfRound(data, 'r1'), null)
  assert.equal(statusOf(data, 'c1').state, 'work')
})

test('a pick after a reject is the person changing mind: picked again', () => {
  const data = before030()
  normalizeTable(data)
  data.feedback.f3 = { card: 'c1', verdict: 'reject', comment: 'again', who: 'user:p', ts: '2026-10-07T12:40:00Z' }
  data.feedback.f4 = { card: 'c1', verdict: 'pick', who: 'user:p', ts: '2026-10-07T12:45:00Z' }
  assert.equal(sentBack(data, 'c1'), false)
  assert.equal(pickOfRound(data, 'r1'), 'c1')
  assert.equal(statusOf(data, 'c1').state, 'picked')
})

test('what the page shows and what the board tells the author agree, in the four ways a reject goes', () => {
  // card a in round r1, one step every 10 minutes; 'v' is a new version handed in
  const run = (steps) => {
    const data = { rounds: { r1: { n: 1, kind: '叙事' } }, cards: { a: { round: 'r1', version: 1, at: '2026-10-07T12:00:00Z' } }, feedback: {} }
    steps.forEach((step, i) => {
      const ts = new Date(Date.parse('2026-10-07T12:10:00Z') + i * 600_000).toISOString()
      if (step === 'v') Object.assign(data.cards.a, { version: data.cards.a.version + 1, updatedAt: ts })
      else data.feedback[`f${i}`] = { card: 'a', verdict: step, ts }
    })
    normalizeTable(data)
    const board = feedbackOf(data, 'a').filter((e) => e.verdict !== 'pick').map((e) => `${e.verdict}:${answered(data, 'a', e)}`)
    return [pickOfRound(data, 'r1'), statusOf(data, 'a').state, board.join(' ')]
  }
  assert.deepEqual(run(['pick', 'reject']), [null, 'work', 'reject:false'])
  assert.deepEqual(run(['pick', 'reject', 'note']), [null, 'work', 'reject:false note:false'])
  assert.deepEqual(run(['pick', 'reject', 'pick']), ['a', 'picked', 'reject:true'])
  assert.deepEqual(run(['reject', 'v', 'pick']), ['a', 'picked', 'reject:true'])
})

test('pickOfRound: two rounds on one slot (位置 left empty, so slot = kind) each keep their own pick', () => {
  const data = {
    rounds: { r1: { n: 1, kind: '叙事', slot: '叙事' }, r2: { n: 2, kind: '叙事', slot: '叙事' } },
    cards: { a: { round: 'r1', version: 1, at: '2026-10-07T12:00:00Z' }, b: { round: 'r2', version: 1, at: '2026-10-07T13:00:00Z' } },
    feedback: {
      f1: { card: 'a', verdict: 'pick', ts: '2026-10-07T12:30:00Z' },
      f2: { card: 'b', verdict: 'pick', ts: '2026-10-07T13:30:00Z' },
    },
  }
  normalizeTable(data)
  assert.equal(pickOfRound(data, 'r1'), 'a')
  assert.equal(pickOfRound(data, 'r2'), 'b')
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

test('a clip keeps its original where it was made: the card shows its cover first, the path is kept relative and inside', async () => {
  const { coverOf, workingCopyPath } = await import('../app/model.js')
  assert.equal(coverOf({ files: ['f1'], video: { cover: 'v1' } }), 'v1')
  assert.equal(coverOf({ files: ['f1'] }), 'f1')
  assert.equal(coverOf({ text: 'only words' }), null)
  assert.equal(workingCopyPath('renders/cut.mp4'), 'renders/cut.mp4')
  assert.equal(workingCopyPath('./renders//cut.mp4'), 'renders/cut.mp4')
  assert.equal(workingCopyPath('renders\\cut.mp4'), 'renders/cut.mp4')
  for (const bad of ['', '/abs/cut.mp4', 'C:\\x\\cut.mp4', '\\\\host\\share\\cut.mp4', '../cut.mp4', 'a/../../cut.mp4']) {
    assert.equal(workingCopyPath(bad), null, bad)
  }
})

test('a clip\'s check as one line on its card: loudness, the longest silence, blank screens only when there are any', () => {
  assert.equal(checkLine(null), '')
  assert.equal(
    checkLine({ lufs: -16.3, peak: -1.2, silence: { seconds: 2.5, at: 26.4 }, black: [], white: [] }),
    '响度 -16.3 LUFS · 最长无声 2.5 秒（26.4 秒处） · 没有黑屏白屏',
  )
  assert.equal(
    checkLine({ lufs: -18, silence: { seconds: 0.1, at: 3 }, black: [[0, 1.5], [10, 10.5]], white: [] }),
    '响度 -18 LUFS · 黑屏 2 秒（0 秒、10 秒处）',
  )
})

test('a picked card carries studio-card and picked as two classes, the ones style.css outlines it by (review 3540e51)', () => {
  assert.deepEqual(cardClass(false).split(' '), ['card', 'studio-card'])
  assert.deepEqual(cardClass(true).split(' '), ['card', 'studio-card', 'picked'])
  const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8')
  assert.match(css, /\.studio-card\.picked\s*\{/)
  // The page draws a card with these classes, not a string of its own.
  assert.match(readFileSync(new URL('../app/app.js', import.meta.url), 'utf8'), /<article class="\$\{cardClass\(isPicked\)\}"/)
})

test('money: something paid never reads $0.000 — under a cent its two first figures (trial 10-12, a $0.000165 sample)', async () => {
  const { money } = await import('../app/model.js')
  assert.deepEqual([0, null, undefined].map(money), ['', '', ''])
  assert.equal(money(0.000171), '$0.00017')
  assert.equal(money(0.001335), '$0.0013')
  assert.equal(money(0.0001), '$0.0001')
  assert.equal(money(0.133), '$0.133')
  assert.equal(money(0.01), '$0.010')
  assert.equal(money(2.5), '$2.50')
})

test('a card\'s history in words beside its marks; the lead named once; escaped line breaks given back', async () => {
  const { leadLabel, marksWords, withBreaks } = await import('../app/model.js')
  const events = [{ kind: 'version' }, { kind: 'note' }, { kind: 'reject' }, { kind: 'version' }, { kind: 'pick' }]
  assert.equal(marksWords(events, true), '交了 2 版 · 批注 1 · 打回 1 · 选中')
  assert.equal(marksWords([{ kind: 'version' }], false), '交了 1 版')
  // A pick taken back by a reject is no pick: the words follow the card, not the count of picks.
  assert.equal(marksWords([{ kind: 'version' }, { kind: 'pick' }, { kind: 'reject' }], false), '交了 1 版 · 打回 1')
  assert.equal(leadLabel('组长'), '组长')
  assert.equal(leadLabel('组长·A1'), '组长·A1')
  assert.equal(leadLabel('Claude 3'), '组长 Claude 3')
  // The Codex writer's card (trial 10-12): one line, its breaks written as backslash-n.
  assert.equal(withBreaks('三个镜头。\\n\\n- 字卡\\n- 出图'), '三个镜头。\n\n- 字卡\n- 出图')
  // Real breaks: written as meant, a backslash-n in it (a code sample) is kept.
  assert.equal(withBreaks('printf("a\\n")\nnext line'), 'printf("a\\n")\nnext line')
  assert.equal(withBreaks(undefined), '')
  // The page draws card text and kept versions through it, and the lead's row through leadLabel.
  const page = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8')
  assert.match(page, /md\.render\(box, withBreaks\(/)
  assert.match(page, /\$\{withBreaks\(e\.saved\?\.text\)\}/)
  assert.match(page, /\$\{leadLabel\(nameOf\(data\.lead\)\)\}：/)
  assert.doesNotMatch(page, /const money = /)
})

test('the person\'s pick or skip wakes the lead — not while the person has the table, not when there is none (review r3, W1)', async () => {
  const { leadToWake } = await import('../app/model.js')
  assert.equal(leadToWake({ lead: 'user:l' }), 'user:l')
  assert.equal(leadToWake({ lead: 'user:l', paused: true }), null)
  assert.equal(leadToWake({}), null)
  // The page's pick and skip wake through it, and only through it.
  const page = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8')
  assert.match(page, /function wakeLead\(text\) \{\s*const lead = leadToWake\(f\.data\)\s*if \(lead\) tell\(lead, text\)/)
  assert.equal((page.match(/tell\(f\.data\.lead/g) ?? []).length, 1) // the hand-back, which wakes it on purpose
})

test('each writer has a folder of its own for a table: two writers sharing a working copy never write one file (trial 10-12)', async () => {
  const { writerFolder } = await import('../app/model.js')
  assert.equal(writerFolder('一笔 · 15 秒.studio.json', 'user:383737d7-b72f-44c2-9637-e2c747969003'), 'studio/一笔 · 15 秒/383737d7')
  assert.notEqual(writerFolder('t.studio.json', 'user:383737d7-x'), writerFolder('t.studio.json', 'user:d47cee7d-x'))
  // A name that would climb or split a path is flattened; no name is still a folder.
  assert.equal(writerFolder('a/../b:c.studio.json', 'user:abc'), 'studio/a .. b c/abc')
  assert.equal(writerFolder(undefined, undefined), 'studio/table/agent')
})

test('what the table has cost: the sum of what the tools paid, by tool, and the payments not priced yet', () => {
  const spend = {
    s1: { tool: 'voice', usd: 0.004, unpriced: 1 },
    s2: { tool: 'image', usd: 0.155 },
    s3: { tool: 'image', usd: null },
  }
  const { total, byTool, unknown } = spendOf({ spend })
  assert.ok(Math.abs(total - 0.159) < 1e-9)
  assert.deepEqual([byTool.voice, byTool.image, unknown], [0.004, 0.155, 2])
  assert.deepEqual(spendOf({}), { total: 0, byTool: {}, unknown: 0 })
})
