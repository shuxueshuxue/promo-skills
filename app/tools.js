// 抽卡台's tools for agents (guide apps-programs): every export is one tool, `agent` is stamped by gugu — never asked for.
// The card table is the file the agent was woken about; what to do with it is the choukatai skill (skills/choukatai).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { feedbackOf, normalizeTable, roundsInOrder, slotOf, statusOf } from './model.js'
import { IMAGE_MODEL, SETTINGS_FILE, parseSettings } from './settings.js'

const BOARD = { type: 'string', format: 'gugu-file', description: 'The card table: the .chouka.json file the whisper you got is about.' }
const now = () => new Date().toISOString()
const newId = (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}`
const short = (text, n = 280) => (text && text.length > n ? `${text.slice(0, n)}…` : text ?? '')

async function openBoard(board) {
  const f = await gugu.files.open({ id: board })
  // The same once-only fill the page does (model.js normalizeTable): a table from before 0.3.0 gets its lines and the
  // cards their (empty) earlier versions, whoever opens it first.
  if (normalizeTable(structuredClone(f.toJSON()))) f.transact(() => normalizeTable(f.data))
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
  // The earlier versions kept, by number (a new version keeps the one it replaces).
  earlierVersions: Object.keys(card.versions ?? {}).map(Number).sort((a, b) => a - b),
  status: statusOf(data, id).label,
  // What people (and the agents they asked) already said about it, the latest few: read before you annotate it too.
  notes: feedbackOf(data, id).filter((entry) => entry.verdict === 'note').slice(-5).map((entry) => ({ who: entry.who, comment: entry.comment, at: entry.ts })),
  files: card.files ?? [],
  parents: card.parents ?? [],
})

export const board = {
  description:
    'Read a 抽卡台 card table: the brief, the rounds that ask you for cards, the rules added on this table, every card with its status and notes, and the feedback on your own cards (answer a reject with a new version of that card). Call it first whenever you are woken about a card table or asked to look at its cards.',
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
          codex: 'skills/promo-video/references/director-rulings.md (rules 1–23) — read it before you hand in or annotate a card',
          added: Object.values(data.rules).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')).map((rule, i) => `${24 + i}. ${rule.text}`),
        },
        askedOfYou: rounds
          .filter(([, r]) => (r.agents ?? []).includes(agent))
          .map(([rid, r]) => ({
            round: rid,
            n: r.n,
            kind: r.kind,
            slot: r.slot,
            track: r.track,
            ask: r.ask || '(nothing more than the brief and the picked cards)',
            each: r.each,
            handedIn: mine.filter(([, card]) => card.round === rid).length,
            refs: (r.refs ?? []).filter((cid) => data.cards[cid]).map((cid) => ({ id: cid, title: data.cards[cid].title, text: short(data.cards[cid].text, 1200), files: data.cards[cid].files ?? [] })),
            otherAgents: (r.agents ?? []).filter((a) => a !== agent),
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
    required: ['board', 'round'],
    properties: {
      board: BOARD,
      round: { type: 'string', description: 'The round id, from board → askedOfYou.' },
      title: { type: 'string', description: 'A few words the person can pick by. A new version keeps the old title (and text, files) unless you give them again.' },
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
    const f = await openBoard(args.board)
    try {
      const round = f.data.rounds[args.round]
      if (!round) throw new Error(`no round ${args.round} on this table — see board → askedOfYou`)
      const at = now()
      const own = args.card && f.data.cards[args.card]?.by === agent ? args.card : null
      // A new version keeps what it does not say again (a revision that only redraws keeps its title and text).
      const prev = own ? f.data.cards[own] : {}
      const fields = {
        title: String(args.title ?? prev.title ?? ''),
        text: String(args.text ?? prev.text ?? ''),
        files: (args.files ?? prev.files ?? []).map(String),
        model: args.model ? String(args.model) : prev.model ?? null,
        cost: { usd: Number(args.cost?.usd) || 0, seconds: Number(args.cost?.seconds) || 0, tokens: Number(args.cost?.tokens) || 0 },
      }
      if (!fields.title) throw new Error('a card needs a title')
      if (!fields.text && !fields.files.length) throw new Error('a card needs text or files')
      let id
      if (own) {
        id = own
        const card = f.data.cards[id]
        // The version this one replaces is kept as it was: the history compares them.
        const replaced = card.version ?? 1
        const versions = { ...(card.versions ?? {}), [replaced]: { title: card.title, text: card.text ?? '', files: card.files ?? [], model: card.model ?? null, cost: card.cost ?? {}, at: card.updatedAt ?? card.at } }
        f.data.cards[id] = { ...fields, round: card.round, slot: card.slot, kind: card.kind, by: agent, parents: card.parents ?? [], version: replaced + 1, versions, at: card.at, updatedAt: at }
      } else {
        id = newId('c')
        const parents = [...new Set([...(args.parents ?? []), ...(args.card ? [args.card] : [])])].filter((cid) => f.data.cards[cid])
        f.data.cards[id] = { ...fields, round: args.round, slot: round.slot, kind: round.kind, by: agent, parents, version: 1, versions: {}, at, updatedAt: at }
      }
      await flushed(f)
      return { card: id, version: f.data.cards[id].version, revised: Boolean(own) }
    } finally {
      f.close()
    }
  },
}

export const note = {
  description:
    'Annotate one card of a 抽卡台 card table, as a person in the chat would with 批注: one or two lines on what works and what to change, citing a rule when one applies (§n of director-rulings.md, or a rule added on the table). It wakes nobody: the author reads it on the table. Use it when someone asks you to look at the cards; the person picks and rejects, you only say what you see. One call per card.',
  inputSchema: {
    type: 'object',
    required: ['board', 'card', 'comment'],
    properties: {
      board: BOARD,
      card: { type: 'string' },
      comment: { type: 'string', description: 'What works, what to change; the rule (§n) when one applies. No score.' },
    },
  },
  async run({ board: id, card, comment }, { agent }) {
    if (!agent) throw new Error('note is for agents (gugu stamps who calls)')
    if (!String(comment ?? '').trim()) throw new Error('a note needs a comment')
    const f = await openBoard(id)
    try {
      const target = f.data.cards[card]
      if (!target) throw new Error(`no card ${card} on this table`)
      f.data.feedback[newId('f')] = { card, verdict: 'note', comment: String(comment).trim(), who: agent, ts: now() }
      await flushed(f)
      // Nobody is woken, as by a person's 批注: a note asks nothing of the author, who reads it on the next board.
      return { card, noted: true }
    } finally {
      f.close()
    }
  },
}

const DATA_DIR = process.env.GUGU_EXTENSION_DATA_DIR ?? path.join(process.cwd(), '.data')
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const readSettings = () => {
  try {
    return parseSettings(readFileSync(path.join(DATA_DIR, SETTINGS_FILE), 'utf8'))
  } catch {
    return {}
  }
}
const keyOf = (settings) => (typeof settings.openrouterKey === 'string' ? settings.openrouterKey.trim() : '')

/** The settings box's 「保存并检查」: OpenRouter's key endpoint answers without making (or charging for) an image. */
export const check_image_key = {
  description: 'Check the OpenRouter key in 抽卡台\'s settings (the card table\'s settings box only).',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  _meta: { ui: { visibility: ['app'] } },
  async run() {
    const settings = path.join(DATA_DIR, SETTINGS_FILE)
    const key = keyOf(readSettings())
    if (!key) return { ok: false, reason: '还没有密钥', settings }
    const headers = { Authorization: `Bearer ${key}` }
    const res = await fetch('https://openrouter.ai/api/v1/key', { headers })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, reason: `OpenRouter 说 HTTP ${res.status}${json.error?.message ? `：${json.error.message}` : ''}`, settings }
    // What can be spent is the smaller of the key's own limit and the account's credits (an empty account answers 402).
    const credits = await fetch('https://openrouter.ai/api/v1/credits', { headers }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const left = [json.data?.limit_remaining, credits?.data ? credits.data.total_credits - credits.data.total_usage : undefined].filter((n) => typeof n === 'number')
    return { ok: true, remaining: left.length ? Math.min(...left) : null, settings }
  },
}

export const image = {
  description:
    'Make one image for a 抽卡台 card — a storyboard frame, a poster, a key visual — with the image model the person set up in the card table (OpenRouter, their key). Answers a local file path: put it in the chat with workspace_upload_file (mime_type image/png), then give its item id in submit → files, and its cost in submit → cost.usd. Use it whichever harness you are; a harness with its own image tool may use that instead.',
  inputSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'The picture, in words: subject, composition, style, what must be on screen. No text in the image unless you ask for it.' },
      aspect: { type: 'string', enum: ['16:9', '1:1', '9:16', '4:3', '3:4'], description: 'Default 16:9 (a frame of the film).' },
      references: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of images on this computer to keep the look of (a mascot, a product screenshot).' },
    },
  },
  async run({ prompt, aspect = '16:9', references = [] }, { agent }) {
    const settings = readSettings()
    const key = keyOf(settings)
    if (!key) throw new Error('No image key yet: the person adds their OpenRouter key under 「出图设置」 on the card table. Until then hand in a precise frame description and say so.')
    const ref = (file) => {
      const mime = MIME[path.extname(file).toLowerCase()]
      if (!mime) throw new Error(`reference ${file}: only png, jpg or webp`)
      return { type: 'image_url', image_url: { url: `data:${mime};base64,${readFileSync(file).toString('base64')}` } }
    }
    const started = Date.now()
    const res = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(240_000), // under Claude's 300 s tool limit: a clear error, not an abort
      body: JSON.stringify({
        model: settings.imageModel || IMAGE_MODEL,
        prompt: String(prompt),
        aspect_ratio: aspect,
        quality: 'high',
        n: 1,
        ...(references.length ? { input_references: references.map(String).map(ref) } : {}),
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.data?.[0]?.b64_json) {
      const why = res.status === 402 ? 'the person\'s OpenRouter account is out of credits' : `the image service said HTTP ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`
      throw new Error(`No image: ${why}. Hand in a precise frame description for now and say so in the card — never draw the frame with a script instead.`)
    }
    const dir = path.join(DATA_DIR, 'images')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${agent ? agent.slice(5, 13) : 'page'}.png`)
    writeFileSync(file, Buffer.from(json.data[0].b64_json, 'base64'))
    // A key that brings its own provider key (BYOK) is charged upstream: OpenRouter's own cost then reads 0.
    const usage = json.usage ?? {}
    return {
      file_path: file,
      model: settings.imageModel || IMAGE_MODEL,
      seconds: Math.round((Date.now() - started) / 1000),
      usd: Number(usage.cost) || Number(usage.cost_details?.upstream_inference_cost) || 0,
      next: 'workspace_upload_file this file_path into the chat (mime_type image/png), then pass its item id in submit → files',
    }
  },
}
