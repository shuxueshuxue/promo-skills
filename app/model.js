// 片场's data, read the same way by the card table (app.js) and the agents' tools (tools.js).
//
// The table is one live JSON file of a chat (`*.studio.json`):
//   brief     what the table is for ({"$text": …}: typed in together)
//   rounds    { [id]: { n, track, kind, slot, ask, each, agents: [user:…], refs: [cardId], by, at } }
//             track: the line the round is a step of (「片子」「文字」…), chosen when the round is opened
//   cards     { [id]: { round, slot, kind, by, model, title, text, files: [itemId], parents: [cardId], version, at, updatedAt,
//                       cost: { usd, seconds, tokens }, versions: { [n]: { title, text, files, model, cost, at } } } }
//             versions: the earlier versions a new one replaced (the current one is the card itself); absent on a card
//             that was never revised from 0.3.0 on
//             video (0.4.0): a clip whose original stays where it was made — { cover: itemId, strip: itemId, seconds,
//             width, height, bytes, sha256, at: { session, path }, check }: the cover (a frame) and the strip (frames in
//             one picture) are in the chat, both made by submit from the clip; the original is the file `path` of that
//             session's working copy, on the machine that made it. check: what submit measured there — { lufs, peak,
//             silence: { seconds, at }, black: [[from, to]], white: [[from, to]] }. A card has files, a video, or both.
//   feedback  { [id]: { card, verdict: note | reject | pick, comment, who, ts } }   append-only, as review/feedback.jsonl was;
//             a note is anyone's — a person's or an agent's they asked to look; reject and pick are the person's
//   rules     { [id]: { text, from, by, at } }                   rules added on this table, on top of director-rulings.md
//   names     { [user:…]: name }                                 members' names as the page last saw them (who wrote a card after they left)
//   spend     { [id]: { tool: voice | image, usd, unpriced?, pending?, by, at, what } } what one call of the App's own tools
//             paid the person's media service, written by that tool (unpriced: purchases the service had not priced
//             yet; pending: their ids, asked again by the next voice or image call, which adds what it finds to usd)
//   lead      user:…  the agent that leads the table: made it with open_round and opens its rounds (absent: the person does)
//   plan      [{ kind, slot, track }]   the rounds the lead means to open next, as it last said (only it writes it)
//   paused    true while the person has taken the table over from the lead (open_round opens nothing)
//   limits    { rounds, writers, each }   the person's own, over LIMITS
//   rounds[].skipped   the person passed a round without a pick: the lead may go on
// Everything many people and agents add to is a map by id (no arrays to fight over).

export const KINDS = ['叙事', '文案', '分镜', '配音', '变式', '片头', '整片', '宣传稿', '其他']
/** What a whisper about a card of this kind adds: pictures come from the App's own image tool, whoever draws. */
export const drawHint = (kind) =>
  kind === '分镜' ? '画面用片场的 image 工具出。' : kind === '配音' ? '小样用片场的 voice 工具出，一个声音一张卡（submit → audio）。' : kind === '整片' ? '旁白用片场的 voice 工具配，配好的片子用 submit → video 交。' : ''

const time = (iso) => Date.parse(iso ?? '') || 0

/** The lines offered when a round is opened; a person can start another. */
export const TRACKS = ['片子', '文字']

/**
 * The table made whole, once, by whoever opens it — the page or an agent's tool, maybe several at the same time. It only
 * adds what is missing, so running it again changes nothing and a value someone set is never replaced. Returns how many
 * things it added (0 once the table is whole).
 * A table written before 0.3.0 has rounds without a line: it is guessed here, the one time, from the round's kind
 * (宣传稿 is 文字, the rest 片子) and from then on read as written. Cards get nothing: `versions` is written by the
 * submit that first revises a card (filling an empty one here could race that write and lose it).
 */
export function normalizeTable(data) {
  let added = 0
  for (const key of ['rounds', 'cards', 'feedback', 'rules', 'names', 'spend']) {
    if (!data[key] || typeof data[key] !== 'object') { data[key] = {}; added += 1 }
  }
  for (const round of Object.values(data.rounds)) {
    if (typeof round.track !== 'string' || !round.track) { round.track = round.kind === '宣传稿' ? '文字' : '片子'; added += 1 }
  }
  return added
}

/** The lines in the order they started (the first is the trunk), each with its rounds in order. */
export function tracksInOrder(data) {
  const tracks = new Map()
  for (const [id, round] of roundsInOrder(data)) {
    if (!tracks.has(round.track)) tracks.set(round.track, [])
    tracks.get(round.track).push(id)
  }
  return [...tracks].map(([name, rounds]) => ({ name, rounds }))
}

/**
 * The card picked in a round: its latest pick, unless that card was sent back since — then no pick until the new
 * version is in (the same judgement statusOf gives agents on board).
 */
export function pickOfRound(data, roundId) {
  const picks = Object.values(data.feedback ?? {})
    .filter((entry) => entry.verdict === 'pick' && data.cards?.[entry.card]?.round === roundId)
    .sort((a, b) => time(b.ts) - time(a.ts))
  const id = picks[0]?.card ?? null
  return id && !sentBack(data, id) ? id : null
}

/**
 * A card sent back: its latest reject is newer than both its latest version and its latest pick. A note after it
 * changes nothing (anyone can write one); a new version answers it, and a pick after it is the person changing mind.
 */
export function sentBack(data, cardId) {
  const card = data.cards[cardId]
  const fb = feedbackOf(data, cardId)
  const reject = fb.filter((entry) => entry.verdict === 'reject').at(-1)
  const pick = fb.filter((entry) => entry.verdict === 'pick').at(-1)
  return Boolean(reject) && time(card.updatedAt ?? card.at) <= time(reject.ts) && time(pick?.ts) < time(reject.ts)
}

/**
 * Whether a note or reject on a card is answered, as an agent's board says it: a newer version is in — or, for a
 * reject, the card is no longer sent back (the person picked it since). `answered: false` on a reject means a new
 * version is owed; on a note only that no newer version has come in since — nothing is owed.
 */
export function answered(data, cardId, entry) {
  const card = data.cards[cardId]
  return time(card.updatedAt ?? card.at) > time(entry.ts) || (entry.verdict === 'reject' && !sentBack(data, cardId))
}

/**
 * A card's history, oldest first: each version handed in (with what it said, when it was kept), and every note, reject
 * and pick. A version whose text a newer one overwrote before 0.3.0 has `lost: true`.
 */
export function eventsOf(data, cardId) {
  const card = data.cards[cardId]
  const current = card.version ?? 1
  const events = []
  for (let v = 1; v <= current; v += 1) {
    if (v === current) {
      events.push({ kind: 'version', version: v, at: card.updatedAt ?? card.at, saved: card })
      continue
    }
    const saved = card.versions?.[String(v)]
    events.push({ kind: 'version', version: v, at: saved?.at ?? card.at, saved: saved ?? null, lost: !saved })
  }
  for (const entry of feedbackOf(data, cardId)) events.push({ kind: entry.verdict, at: entry.ts, who: entry.who, comment: entry.comment ?? '' })
  return events.sort((a, b) => time(a.at) - time(b.at) || (a.kind === 'version' ? -1 : 1))
}

/** Every card's feedback, oldest first. */
export function feedbackOf(data, cardId) {
  return Object.values(data.feedback ?? {})
    .filter((entry) => entry.card === cardId)
    .sort((a, b) => time(a.ts) - time(b.ts))
}

/** The pick of a slot that stands: its latest. */
export function pickOf(data, slot) {
  const picks = Object.values(data.feedback ?? {})
    .filter((entry) => entry.verdict === 'pick' && data.cards?.[entry.card] && slotOf(data, data.cards[entry.card]) === slot)
    .sort((a, b) => time(b.ts) - time(a.ts))
  return picks[0]?.card ?? null
}

export function slotOf(data, card) {
  return card.slot || data.rounds?.[card.round]?.slot || card.kind || '其他'
}

/**
 * Where a card stands — promo-skills' review state machine, unchanged: there is no "approve"; a reject is answered the
 * moment a newer version of the card exists. A pick is the person choosing it for its slot.
 */
export function statusOf(data, cardId) {
  const card = data.cards[cardId]
  const fb = feedbackOf(data, cardId).filter((entry) => entry.verdict !== 'pick')
  const rejects = fb.filter((entry) => entry.verdict === 'reject').length
  const updated = time(card.updatedAt ?? card.at)
  const last = fb.at(-1)
  if (sentBack(data, cardId)) return { state: 'work', label: `打回 ×${rejects} · 整改中`, rejects }
  if (pickOf(data, slotOf(data, card)) === cardId) return { state: 'picked', label: '已选', rejects }
  if (!last) return { state: 'new', label: '待你挑', rejects }
  if (last.verdict === 'reject') return { state: 'review', label: `待复审 第 ${rejects + 1} 轮`, rejects }
  return updated > time(last.ts) ? { state: 'review', label: '批注后有新版', rejects } : { state: 'review', label: '有批注', rejects }
}

/** A round's cards and what they cost, as the cards say (an agent reports its own; media cost is the API's own number). */
export function roundSummary(data, roundId) {
  const cards = Object.entries(data.cards ?? {}).filter(([, card]) => card.round === roundId)
  const sum = (key) => cards.reduce((total, [, card]) => total + (Number(card.cost?.[key]) || 0), 0)
  return { count: cards.length, usd: sum('usd'), seconds: sum('seconds'), tokens: sum('tokens') }
}

/** Whether every agent asked in a round has handed in its cards. */
export function roundComplete(data, roundId) {
  const round = data.rounds?.[roundId]
  if (!round) return false
  const mine = (agent) => Object.values(data.cards ?? {}).filter((card) => card.round === roundId && card.by === agent).length
  return (round.agents ?? []).every((agent) => mine(agent) >= (round.each ?? 1))
}

/** The picture a card shows first (its spine dot, its first face): a clip's cover, else its first file. */
/**
 * What a table keeps unless the person changes it in its settings (`limits` on the table): rounds on the table, writers
 * a round may call, cards each. They keep a lead agent from spending without the person: rounds open one at a time,
 * and only after the person picked.
 */
export const LIMITS = { rounds: 8, writers: 4, each: 3 }
export const limitsOf = (data) => ({ ...LIMITS, ...(data.limits ?? {}) })

/** What a writer is woken with when a round opens — the same words whoever opened it. */
export const roundCall = ({ n, slot, kind, each }) =>
  `片场第 ${n} 轮：${slot}（${kind}），每人 ${each} 张。先用片场的 board 工具读卡桌（要求和参考都在那里），每张卡用 submit 交。${drawHint(kind)}`

/** A round put on the table — by the person on the page or by the lead's open_round, one way for both. Its number. */
export function addRound(data, { id, track, kind, slot, ask, each, agents, refs }, by, at) {
  const n = Object.keys(data.rounds).length + 1
  data.rounds[id] = { n, track, kind, slot, ask: ask ?? '', each, agents, refs: refs ?? [], by, at }
  return n
}

/** The picked card of every round so far: what a new round builds on unless it names its own. */
export const picksSoFar = (data) => roundsInOrder(data).map(([id]) => pickOfRound(data, id)).filter(Boolean)

/** The first round the person has neither picked from nor skipped: what a lead waits for before the next one. */
export function waitingRound(data) {
  for (const [id, round] of roundsInOrder(data)) if (!round.skipped && !pickOfRound(data, id)) return { id, n: round.n, slot: round.slot }
  return null
}

/** What this table has cost so far, by tool: the sum of what the tools paid, and how many payments have no amount yet. */
export function spendOf(data) {
  const byTool = {}
  let total = 0
  let unknown = 0
  for (const entry of Object.values(data.spend ?? {})) {
    // unpriced: purchases in one call the service had not priced yet; usd is what the rest of that call cost.
    unknown += Number(entry.unpriced) || 0
    if (typeof entry.usd !== 'number') {
      unknown += 1
      continue
    }
    total += entry.usd
    byTool[entry.tool] = (byTool[entry.tool] ?? 0) + entry.usd
  }
  return { total, byTool, unknown }
}

/** A clip's check as one line on its card: loudness, the longest silence, blank screens (only when there are any). */
export function checkLine(check) {
  if (!check) return ''
  const s = (n) => `${Math.round(n * 10) / 10} 秒`
  const blanks = (name, list) => (list?.length ? `${name} ${s(list.reduce((sum, [a, b]) => sum + (b - a), 0))}（${list.map(([a]) => s(a)).slice(0, 3).join('、')}处）` : '')
  return [
    check.lufs === null || check.lufs === undefined ? '' : `响度 ${check.lufs} LUFS`,
    check.silence?.seconds >= 0.3 ? `最长无声 ${s(check.silence.seconds)}（${s(check.silence.at)}处）` : '',
    blanks('黑屏', check.black),
    blanks('白屏', check.white),
    !check.black?.length && !check.white?.length ? '没有黑屏白屏' : '',
  ].filter(Boolean).join(' · ')
}

/** A card's classes on the page: style.css styles .studio-card, and .studio-card.picked outlines the picked one. */
export const cardClass = (picked) => ['card', 'studio-card', ...(picked ? ['picked'] : [])].join(' ')

/**
 * Dollars as the table shows them: cents from a dollar up, tenths of a cent under that, and under a cent its two first
 * figures ($0.00017) — something paid for never reads $0.000 (trial 10-12, a voice sample).
 */
export function money(usd) {
  if (!usd) return ''
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(1 - Math.floor(Math.log10(usd))).replace(/0+$/, '')}`
}

/** A card's history in words, beside its marks: how many versions, notes and rejects, and whether it is the pick. */
export function marksWords(events, picked) {
  const count = (kind) => events.filter((e) => e.kind === kind).length
  return [
    `交了 ${count('version')} 版`,
    count('note') ? `批注 ${count('note')}` : '',
    count('reject') ? `打回 ${count('reject')}` : '',
    picked ? '选中' : '',
  ].filter(Boolean).join(' · ')
}

/** Who leads, as the lead's row names it: 组长 and its name — once, when the name says it already (trial 10-12: 组长 组长). */
export const leadLabel = (name) => (String(name).includes('组长') ? String(name) : `组长 ${name}`)

/**
 * A card's text with its line breaks: an agent that escaped them (backslash-n, and not one real break — trial 10-12, a
 * Codex writer) gets them back. A text with real breaks is left as written, backslashes and all.
 */
export function withBreaks(text) {
  const s = String(text ?? '')
  return !s.includes('\n') && s.includes('\\n') ? s.replace(/\\r\\n|\\n/g, '\n') : s
}

export const coverOf = (card) => card?.video?.cover ?? card?.files?.[0] ?? null

/**
 * A path in a working copy as a card keeps it (POSIX, relative, inside): null when it is empty, absolute, or climbs out.
 * The tool still checks the real path on the disk (a link out); this is the shape alone.
 */
export function workingCopyPath(path) {
  const slashed = String(path ?? '').replace(/\\/g, '/')
  const parts = slashed.split('/').filter((part) => part && part !== '.')
  if (!parts.length || slashed.startsWith('/') || /^[a-z]:$/i.test(parts[0]) || parts.includes('..')) return null
  return parts.join('/')
}

export const roundsInOrder = (data) => Object.entries(data.rounds ?? {}).sort(([, a], [, b]) => (a.n ?? 0) - (b.n ?? 0))
