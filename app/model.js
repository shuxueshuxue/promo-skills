// 抽卡台's data, read the same way by the card table (app.js) and the agents' tools (tools.js).
//
// The table is one live JSON file of a chat (`*.chouka.json`):
//   brief     what the table is for ({"$text": …}: typed in together)
//   rounds    { [id]: { n, kind, slot, ask, each, agents: [user:…], refs: [cardId], by, at } }
//   cards     { [id]: { round, slot, kind, by, model, title, text, files: [itemId], parents: [cardId], version, at, updatedAt,
//                       cost: { usd, seconds, tokens } } }
//   feedback  { [id]: { card, verdict: note | reject | pick, comment, who, ts } }   append-only, as review/feedback.jsonl was;
//             a note is anyone's — a person's or an agent's they asked to look; reject and pick are the person's
//   rules     { [id]: { text, from, by, at } }                   rules added on this table, on top of director-rulings.md
//   names     { [user:…]: name }                                 members' names as the page last saw them (who wrote a card after they left)
// Everything many people and agents add to is a map by id (no arrays to fight over).

export const KINDS = ['叙事', '文案', '分镜', '变式', '片头', '整片', '宣传稿', '其他']
/** What a whisper about a card of this kind adds: pictures come from the App's own image tool, whoever draws. */
export const drawHint = (kind) => (kind === '分镜' ? '画面用抽卡台的 image 工具出。' : '')

const time = (iso) => Date.parse(iso ?? '') || 0

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
  if (pickOf(data, slotOf(data, card)) === cardId && !(last?.verdict === 'reject' && updated <= time(last.ts))) {
    return { state: 'picked', label: '已选', rejects }
  }
  if (!last) return { state: 'new', label: '待你挑', rejects }
  if (last.verdict === 'reject') {
    return updated > time(last.ts)
      ? { state: 'review', label: `待复审 第 ${rejects + 1} 轮`, rejects }
      : { state: 'work', label: `打回 ×${rejects} · 整改中`, rejects }
  }
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

export const roundsInOrder = (data) => Object.entries(data.rounds ?? {}).sort(([, a], [, b]) => (a.n ?? 0) - (b.n ?? 0))
