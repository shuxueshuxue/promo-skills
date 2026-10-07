// 抽卡台's tools for agents (guide apps-programs): every export is one tool, `agent` is stamped by gugu — never asked for.
// The card table is the file the agent was woken about; what to do with it is the choukatai skill (skills/choukatai).
import { feedbackOf, roundComplete, roundsInOrder, slotOf, statusOf } from './model.js'

const BOARD = { type: 'string', format: 'gugu-file', description: 'The card table: the .chouka.json file the whisper you got is about.' }
const now = () => new Date().toISOString()
const newId = (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}`
const short = (text, n = 280) => (text && text.length > n ? `${text.slice(0, n)}…` : text ?? '')

async function openBoard(board) {
  const f = await gugu.files.open({ id: board })
  for (const key of ['rounds', 'cards', 'notes', 'feedback', 'rules']) if (!f.data[key] || typeof f.data[key] !== 'object') f.data[key] = {}
  return f
}

/** Written through before the call answers: an agent that reads the table next must find its own card there. */
function flushed(f) {
  if (f.saved) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the card table did not save within 10 s — try again')), 10_000)
    f.onStatus(() => {
      if (f.saved) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

const cardLine = (data, id, card) => ({
  id,
  round: data.rounds[card.round]?.n ?? null,
  slot: slotOf(data, card),
  kind: card.kind,
  title: card.title,
  by: card.by,
  model: card.model ?? null,
  version: card.version ?? 1,
  status: statusOf(data, id).label,
  critic: data.notes[id] ? { score: data.notes[id].score, comment: data.notes[id].comment } : null,
  files: card.files ?? [],
  parents: card.parents ?? [],
})

export const board = {
  description:
    'Read a 抽卡台 card table: the brief, the rounds that ask you for cards, the rounds you are the critic of, the rules added on this table, every card with its status, and the feedback on your own cards (answer a reject with a new version of that card). Call it first whenever you are woken about a card table.',
  inputSchema: { type: 'object', required: ['board'], properties: { board: BOARD } },
  annotations: { readOnlyHint: true },
  async run({ board: id }, { agent }) {
    const f = await openBoard(id)
    try {
      const data = f.toJSON()
      const cards = Object.entries(data.cards)
      const mine = cards.filter(([, card]) => card.by === agent)
      const rounds = roundsInOrder(data)
      return {
        brief: String(data.brief ?? ''),
        you: agent,
        rules: {
          codex: 'skills/promo-video/references/director-rulings.md (rules 1–23) — read it before you hand in or judge a card',
          added: Object.values(data.rules).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')).map((rule, i) => `${24 + i}. ${rule.text}`),
        },
        askedOfYou: rounds
          .filter(([, r]) => (r.agents ?? []).includes(agent))
          .map(([rid, r]) => ({
            round: rid,
            n: r.n,
            kind: r.kind,
            slot: r.slot,
            ask: r.ask || '(nothing more than the brief and the picked cards)',
            each: r.each,
            handedIn: mine.filter(([, card]) => card.round === rid).length,
            refs: (r.refs ?? []).filter((cid) => data.cards[cid]).map((cid) => ({ id: cid, title: data.cards[cid].title, text: short(data.cards[cid].text, 1200), files: data.cards[cid].files ?? [] })),
            otherAgents: (r.agents ?? []).filter((a) => a !== agent),
          })),
        criticOf: rounds
          .filter(([, r]) => r.critic === agent)
          .map(([rid, r]) => ({
            round: rid,
            n: r.n,
            complete: roundComplete(data, rid),
            waiting: cards.filter(([cid, card]) => card.round === rid && !data.notes[cid]).map(([cid]) => cid),
          })),
        feedbackOnYours: mine.flatMap(([cid, card]) =>
          feedbackOf(data, cid)
            .filter((entry) => entry.verdict !== 'pick')
            .map((entry) => ({ card: cid, title: card.title, verdict: entry.verdict, comment: entry.comment, at: entry.ts, answered: Date.parse(card.updatedAt ?? card.at) > Date.parse(entry.ts) })),
        ),
        cards: cards.map(([cid, card]) => ({ ...cardLine(data, cid, card), text: short(card.text) })),
      }
    } finally {
      f.close()
    }
  },
}

export const submit = {
  description:
    'Hand in one card for a round of a 抽卡台 card table — or a new version of one of your own cards (pass `card`; that is how a reject is answered). A card is a title plus text (markdown) and/or files you put in the same chat first with workspace_upload_file (give their item ids). Report what it cost: media dollars as the image/video API reported them, wall seconds, your approximate tokens. One call per card.',
  inputSchema: {
    type: 'object',
    required: ['board', 'round', 'title'],
    properties: {
      board: BOARD,
      round: { type: 'string', description: 'The round id, from board → askedOfYou.' },
      title: { type: 'string', description: 'A few words the person can pick by.' },
      text: { type: 'string', description: 'The card itself in markdown: the narrative, the copy, the shot description, what a clip shows.' },
      files: { type: 'array', items: { type: 'string' }, description: 'Item ids of files in this chat (images, clips, audio) that are this card.' },
      card: { type: 'string', description: 'Your own card to revise (a new version of it). Someone else\'s card: pass it in parents instead.' },
      parents: { type: 'array', items: { type: 'string' }, description: 'Cards this one mixes or builds on.' },
      model: { type: 'string', description: 'The model you are (shown on the card).' },
      cost: {
        type: 'object',
        properties: { usd: { type: 'number' }, seconds: { type: 'number' }, tokens: { type: 'number' } },
        description: 'usd: media APIs only (their own usage.cost); seconds: wall time this card took; tokens: your own, approximate.',
      },
    },
  },
  async run(args, { agent }) {
    if (!agent) throw new Error('submit is for agents (gugu stamps who calls)')
    if (!args.text && !(args.files ?? []).length) throw new Error('a card needs text or files')
    const f = await openBoard(args.board)
    try {
      const round = f.data.rounds[args.round]
      if (!round) throw new Error(`no round ${args.round} on this table — see board → askedOfYou`)
      const at = now()
      const fields = {
        title: String(args.title),
        text: String(args.text ?? ''),
        files: (args.files ?? []).map(String),
        model: args.model ? String(args.model) : null,
        cost: { usd: Number(args.cost?.usd) || 0, seconds: Number(args.cost?.seconds) || 0, tokens: Number(args.cost?.tokens) || 0 },
      }
      const own = args.card && f.data.cards[args.card]?.by === agent ? args.card : null
      let id
      if (own) {
        id = own
        const card = f.data.cards[id]
        f.data.cards[id] = { ...fields, round: card.round, slot: card.slot, kind: card.kind, by: agent, parents: card.parents ?? [], version: (card.version ?? 1) + 1, at: card.at, updatedAt: at }
      } else {
        id = newId('c')
        const parents = [...new Set([...(args.parents ?? []), ...(args.card ? [args.card] : [])])].filter((cid) => f.data.cards[cid])
        f.data.cards[id] = { ...fields, round: args.round, slot: round.slot, kind: round.kind, by: agent, parents, version: 1, at, updatedAt: at }
      }
      // The round is in: the critic is woken once, with the whole round (not once a card).
      let woke = null
      if (round.critic && round.critic !== agent && !round.criticWoken && roundComplete(f.data, args.round)) {
        f.data.rounds[args.round].criticWoken = at
        woke = round.critic
      }
      await flushed(f)
      if (woke) await gugu.send(woke, `抽卡台第 ${round.n} 轮的卡交齐了，等你评。`, { about: f.entry })
      return { card: id, version: f.data.cards[id].version, revised: Boolean(own), criticWoken: Boolean(woke) }
    } finally {
      f.close()
    }
  },
}

export const note = {
  description:
    'As the critic of a 抽卡台 round: score one card 0–10 and say why in one line, citing the rule it keeps or breaks (§n of director-rulings.md, or a rule added on the table). Cards at 4 or below are folded away from the person; the person still decides. One call per card.',
  inputSchema: {
    type: 'object',
    required: ['board', 'card', 'score', 'comment'],
    properties: {
      board: BOARD,
      card: { type: 'string' },
      score: { type: 'number', minimum: 0, maximum: 10 },
      comment: { type: 'string', description: 'One line: what it gets right or wrong, with the rule (§n).' },
    },
  },
  async run({ board: id, card, score, comment }, { agent }) {
    if (!agent) throw new Error('note is for agents (gugu stamps who calls)')
    const f = await openBoard(id)
    try {
      const target = f.data.cards[card]
      if (!target) throw new Error(`no card ${card} on this table`)
      if (target.by === agent) throw new Error('that is your own card: the critic of a round is someone who did not hand in to it')
      f.data.notes[card] = { score: Math.max(0, Math.min(10, Number(score) || 0)), comment: String(comment), by: agent, at: now() }
      // The round fully read: the person who opened it is told once, so they need not watch the table.
      const roundId = target.round
      const round = f.data.rounds[roundId]
      let told = null
      const unread = Object.entries(f.data.cards).filter(([cid, c]) => c.round === roundId && !f.data.notes[cid]).length
      if (round && !round.readTold && unread === 0 && roundComplete(f.data, roundId) && round.by) {
        f.data.rounds[roundId].readTold = now()
        told = round.by
      }
      await flushed(f)
      if (told) await gugu.send(told, `抽卡台第 ${round.n} 轮评完了，可以挑了。`, { about: f.entry })
      return { card, score: f.data.notes[card].score, toldThePerson: Boolean(told) }
    } finally {
      f.close()
    }
  },
}
