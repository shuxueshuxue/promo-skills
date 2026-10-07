// 抽卡台 — the card table. Several agents (different models, different harnesses) each hand in cards for a round; a
// critic agent reads them against the director's rulings first; the person picks, annotates or rejects. Picked cards are
// what the next round mixes. Review rules are promo-skills' (skills/promo-video/references/review-loop.md): reject or
// annotate, never "approve"; a reject is answered by a newer version of the card.
import { f, me, $, html, render } from '/_gugu/1/glue.js'
import { KINDS, feedbackOf, pickOf, roundComplete, roundSummary, roundsInOrder, slotOf, statusOf } from './model.js'

const ctx = await window.gugu.getContext()
const chatId = f.entry.chat ?? ctx.chat?.id
let members = ctx.chat?.members ?? []
const now = () => new Date().toISOString()
const newId = (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}`
const nameOf = (id) => members.find((m) => m.id === id)?.name ?? (id ? id.slice(5, 13) : '?')
const agents = () => members.filter((m) => m.kind === 'agent')

// A table made by an agent may lack a map: made once, here, so every write below can rely on it.
f.transact(() => {
  for (const key of ['rounds', 'cards', 'notes', 'feedback', 'rules']) if (!f.data[key] || typeof f.data[key] !== 'object') f.data[key] = {}
  if (f.data.brief === undefined) f.data.brief = window.gugu.text('')
})

/** Wake the one it concerns; what happened is in the file. A refusal is said, never swallowed. */
async function tell(to, text) {
  if (!to) return
  try {
    await window.gugu.send(to, text, { about: f.entry })
  } catch (error) {
    say(`没叫到 ${nameOf(to)}：${error.code ?? ''} ${error.message}`, 'error')
  }
}
function say(message, tone = 'info') {
  const line = $('#status')
  line.setAttribute('role', tone === 'error' ? 'alert' : 'status')
  line.textContent = message
}

// ─── media: a card's files, opened read-only as their bytes (gugu.files.open → blob()) ──────────────────────────────
const media = new Map() // itemId → 'loading' | { url, kind, name } | { error }
async function loadMedia(itemId) {
  media.set(itemId, 'loading')
  try {
    const file = await window.gugu.files.open({ chat: chatId, id: itemId })
    if (file.type === 'binary') {
      const blob = await file.blob()
      const name = file.entry.name
      const kind = /^video\//.test(blob.type) || /\.(mp4|mov|webm)$/i.test(name) ? 'video' : /^audio\//.test(blob.type) || /\.(mp3|wav|m4a)$/i.test(name) ? 'audio' : 'image'
      media.set(itemId, { url: URL.createObjectURL(blob), kind, name })
    } else {
      media.set(itemId, { kind: 'text', name: file.entry.name, text: String(file.text ?? JSON.stringify(file.toJSON?.() ?? {}, null, 1)).slice(0, 1200) })
    }
    file.close()
  } catch (error) {
    media.set(itemId, { error: error.code === 'invalid' ? `这台咕咕还打不开图片和视频（${error.message}）` : `打不开：${error.message}` })
  }
  draw()
}
function mediaView(itemId) {
  const m = media.get(itemId)
  if (!m) {
    queueMicrotask(() => media.has(itemId) || loadMedia(itemId))
    return html`<div class="media" data-key="${itemId}"></div>`
  }
  if (m === 'loading') return html`<div class="media" data-key="${itemId}"></div>`
  if (m.error) return html`<small class="muted" data-key="${itemId}">${m.error}</small>`
  if (m.kind === 'video') return html`<video class="media" data-key="${itemId}" src="${m.url}" controls muted playsinline preload="metadata"></video>`
  if (m.kind === 'audio') return html`<audio data-key="${itemId}" src="${m.url}" controls preload="metadata"></audio>`
  if (m.kind === 'text') return html`<pre data-key="${itemId}">${m.text}</pre>`
  return html`<img class="media" data-key="${itemId}" src="${m.url}" alt="${m.name}" />`
}

// ─── the controls: drawn once (drafts and the brief's editor live here, out of render's way) ───────────────────────
$('#controls').innerHTML = `
  <div class="card stack">
    <label>需求 <textarea id="brief" rows="3" placeholder="一句话：要做什么、给谁看、多长"></textarea></label>
    <details id="rules-box"><summary>导演法典</summary><div id="rules"></div></details>
  </div>
  <details class="card" id="round-box">
    <summary><strong>开一轮</strong></summary>
    <div class="stack">
      <div class="row">
        <label>出什么 <select id="r-kind"></select></label>
        <label>位置 <input id="r-slot" placeholder="比如：叙事主线、第 3 拍" /></label>
        <label>每人几张 <input id="r-each" type="number" min="1" max="5" value="2" /></label>
      </div>
      <label>这一轮的要求 <textarea id="r-ask" rows="2" placeholder="可以空着：照需求和已选的卡来"></textarea></label>
      <fieldset><legend>谁来出卡</legend><div id="r-agents" class="agents"></div></fieldset>
      <label>评审 <select id="r-critic"></select></label>
      <small class="muted" id="r-refs"></small>
      <div class="row"><button class="primary" id="r-start">开始</button></div>
    </div>
  </details>
  <dialog id="say-box">
    <div class="stack">
      <strong id="say-title"></strong>
      <textarea id="say-text" rows="4" placeholder="哪里不对、下一版怎么改"></textarea>
      <label><input type="checkbox" id="say-rule" /> 同时升为规矩（以后每一轮都照它）</label>
      <div class="row"><button id="say-cancel">取消</button><button class="primary" id="say-send">提交</button></div>
    </div>
  </dialog>`

$('#r-kind').innerHTML = KINDS.map((k) => `<option>${k}</option>`).join('')
try {
  window.gugu.bind.text($('#brief'), f.textAt(['brief']))
} catch {
  // An agent wrote the brief as a plain string: shown, typed over as one value.
  $('#brief').value = String(f.data.brief ?? '')
  $('#brief').onchange = () => { f.data.brief = window.gugu.text($('#brief').value) }
}

const chosenAgents = new Set()
function drawRoundForm() {
  const list = agents()
  render($('#r-agents'), list.length
    ? html`${list.map((a) => html`<label data-key="${a.id}"><input type="checkbox" data-agent="${a.id}" ${chosenAgents.has(a.id) ? html`checked` : ''} /> <gugu-avatar user="${a.id}" size="xs"></gugu-avatar> ${a.name}</label>`)}`
    : html`<small class="muted">这个对话里还没有 Agent：先把几个不同模型的 Agent 拉进来。</small>`)
  const critic = $('#r-critic').value
  render($('#r-critic'), html`<option value="">（不要评审）</option>${list.map((a) => html`<option value="${a.id}" ${a.id === critic ? html`selected` : ''}>${a.name}</option>`)}`)
  const picked = pickedCards()
  $('#r-refs').textContent = picked.length ? `参考（已选的卡）：${picked.map(([, c]) => c.title).join('、')}` : ''
}
$('#r-agents').addEventListener('change', (event) => {
  const id = event.target.dataset?.agent
  if (!id) return
  if (event.target.checked) chosenAgents.add(id)
  else chosenAgents.delete(id)
})
const pickedCards = () => {
  const slots = new Set(Object.values(f.data.cards).map((card) => slotOf(f.data, card)))
  return [...slots].map((slot) => pickOf(f.data, slot)).filter(Boolean).map((id) => [id, f.data.cards[id]])
}

$('#r-start').onclick = async () => {
  const chosen = [...chosenAgents].filter((id) => agents().some((a) => a.id === id))
  if (!chosen.length) return say('先勾上至少一个 Agent', 'error')
  const kind = $('#r-kind').value
  const slot = $('#r-slot').value.trim() || kind
  const each = Math.max(1, Math.min(5, Number($('#r-each').value) || 1))
  const critic = $('#r-critic').value || null
  const n = Object.keys(f.data.rounds).length + 1
  const id = newId('r')
  f.data.rounds[id] = { n, kind, slot, ask: $('#r-ask').value.trim(), each, agents: chosen, critic, refs: pickedCards().map(([cardId]) => cardId), by: me, at: now() }
  $('#r-ask').value = ''
  $('#round-box').open = false
  say(`第 ${n} 轮开始了：叫了 ${chosen.map(nameOf).join('、')}`)
  for (const agent of chosen) await tell(agent, `抽卡台第 ${n} 轮：${slot}（${kind}），每人 ${each} 张。要求和参考都在卡桌上。`)
}

// ─── annotate / reject: one dialog, drawn once ───────────────────────────────────────────────────────────────────────
let pending = null // { card, verdict }
function ask(cardId, verdict) {
  pending = { card: cardId, verdict }
  $('#say-title').textContent = `${verdict === 'reject' ? '打回' : '批注'}：${f.data.cards[cardId]?.title ?? ''}`
  $('#say-text').value = ''
  $('#say-rule').checked = false
  $('#say-box').showModal()
}
$('#say-cancel').onclick = () => $('#say-box').close()
$('#say-send').onclick = async () => {
  const comment = $('#say-text').value.trim()
  if (!pending || (!comment && pending.verdict === 'note')) return
  const { card: cardId, verdict } = pending
  const id = newId('f')
  f.transact(() => {
    f.data.feedback[id] = { card: cardId, verdict, comment, who: me, ts: now() }
    if ($('#say-rule').checked && comment) f.data.rules[newId('rule')] = { text: comment, from: id, by: me, at: now() }
  })
  $('#say-box').close()
  const card = f.data.cards[cardId]
  await tell(card?.by, `「${card?.title}」${verdict === 'reject' ? '被打回了' : '有一条新批注'}，看卡桌。`)
}

// ─── the table ───────────────────────────────────────────────────────────────────────────────────────────────────────
const unfolded = new Set() // slots whose folded cards are shown
const opened = new Set() // cards shown in full
$('#shared').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-act]')
  if (!button) return
  const { act, card, round, slot } = button.dataset
  if (act === 'pick') f.data.feedback[newId('f')] = { card, verdict: 'pick', who: me, ts: now() }
  else if (act === 'note' || act === 'reject') ask(card, act)
  else if (act === 'open') (opened.has(card) ? opened.delete(card) : opened.add(card), draw())
  else if (act === 'unfold') (unfolded.has(slot) ? unfolded.delete(slot) : unfolded.add(slot), draw())
  else if (act === 'critic') {
    const r = f.data.rounds[round]
    await tell(r.critic, `第 ${r.n} 轮有 ${roundSummary(f.data, round).count} 张卡等你评。`)
    say(`叫了评审 ${nameOf(r.critic)}`)
  }
})

const money = (usd) => (usd ? `$${usd.toFixed(usd < 1 ? 3 : 2)}` : '$0')
const seconds = (s) => (s >= 90 ? `${Math.round(s / 60)} 分` : `${Math.round(s)} 秒`)
const tokens = (t) => (t >= 1000 ? `约 ${(t / 1000).toFixed(1)}k tok` : t ? `约 ${t} tok` : '')

function cardView(id, card) {
  const status = statusOf(f.data, id)
  const note = f.data.notes[id]
  const history = feedbackOf(f.data, id)
  const tone = status.state === 'picked' ? 'ok' : status.state === 'work' ? 'bad' : status.state === 'review' ? 'warn' : ''
  const cost = [card.cost?.usd ? money(card.cost.usd) : '', card.cost?.seconds ? seconds(card.cost.seconds) : '', tokens(card.cost?.tokens)].filter(Boolean).join(' · ')
  return html`
    <article class="card chouka-card ${status.state === 'picked' ? 'picked' : ''} ${status.state === 'work' ? 'rejected' : ''} ${opened.has(id) ? 'open' : ''}" data-key="${id}">
      ${(card.files ?? []).map(mediaView)}
      <strong>${card.title}${card.version > 1 ? html` <small class="muted">第 ${card.version} 版</small>` : ''}</strong>
      ${card.text ? html`<div class="text">${card.text}</div>` : ''}
      ${card.text && card.text.length > 160 ? html`<button class="sm" data-act="open" data-card="${id}">${opened.has(id) ? '收起' : '展开'}</button>` : ''}
      ${note ? html`<div class="critic"><strong>评审 ${note.score}/10</strong> · ${note.comment}</div>` : ''}
      ${history.length ? html`<small class="muted">${history.map((h) => html`<span>${h.verdict === 'reject' ? '打回' : h.verdict === 'pick' ? '选了' : '批注'}${h.comment ? `：${h.comment}` : ''}（${nameOf(h.who)}）</span><br />`)}</small>` : ''}
      <div class="row">
        <gugu-avatar user="${card.by}" size="xs"></gugu-avatar>
        <small>${nameOf(card.by)}${card.model ? ` · ${card.model}` : ''}</small>
        <span class="tag ${tone}">${status.label}</span>
      </div>
      ${cost ? html`<small class="muted">${cost}</small>` : ''}
      <div class="row">
        ${status.state === 'picked' ? '' : html`<button data-act="pick" data-card="${id}">选这张</button>`}
        <button data-act="note" data-card="${id}">批注</button>
        <button class="danger" data-act="reject" data-card="${id}">打回</button>
      </div>
    </article>`
}

function draw() {
  const data = f.data
  const cards = Object.entries(data.cards)
  const rounds = roundsInOrder(data)
  const slots = [...new Set(cards.map(([, card]) => slotOf(data, card)))]
  const rules = Object.values(data.rules).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  render($('#rules'), html`<small class="muted">底子是 promo-video skill 里 director-rulings.md 的 23 条；下面是在这张卡桌上被打回后升上来的${rules.length ? '' : '（还没有）'}。</small>
    <ol start="24">${rules.map((r) => html`<li data-key="${r.from}">${r.text}</li>`)}</ol>`)
  $('#rules-box').querySelector('summary').textContent = `导演法典 · 23 + ${rules.length} 条`

  render($('#shared'), html`
    ${rounds.length ? html`<div class="row">${rounds.map(([id, r]) => {
      const s = roundSummary(data, id)
      const done = roundComplete(data, id)
      return html`<span class="tag" data-key="${id}">第 ${r.n} 轮 · ${r.slot} · ${s.count} 张${s.usd ? ` · ${money(s.usd)}` : ''}${s.seconds ? ` · ${seconds(s.seconds)}` : ''}${s.tokens ? ` · ${tokens(s.tokens)}` : ''}${done ? ' · 交齐了' : ''}</span>
        ${r.critic && s.count ? html`<button class="sm" data-act="critic" data-round="${id}">叫评审</button>` : ''}`
    })}</div>` : html`<gugu-empty icon="checklist"><strong>还没有卡</strong><small>写好需求，开第一轮</small></gugu-empty>`}
    ${slots.map((slot) => {
      const inSlot = cards.filter(([, card]) => slotOf(data, card) === slot)
        .sort(([, a], [, b]) => (data.rounds[a.round]?.n ?? 0) - (data.rounds[b.round]?.n ?? 0) || (a.at ?? '').localeCompare(b.at ?? ''))
      const folded = inSlot.filter(([id]) => (data.notes[id]?.score ?? 10) <= 4 && statusOf(data, id).state !== 'picked')
      const shown = unfolded.has(slot) ? inSlot : inSlot.filter((entry) => !folded.includes(entry))
      const pick = pickOf(data, slot)
      return html`<section class="stack" data-key="slot:${slot}">
        <div class="slot-head"><h3>${slot}</h3>${pick ? html`<span class="tag ok">已选 · ${data.cards[pick]?.title}</span>` : ''}<small class="muted">${inSlot.length} 张</small></div>
        <div class="cards">
          ${shown.map(([id, card]) => cardView(id, card))}
          ${folded.length ? html`<button class="fold" data-act="unfold" data-slot="${slot}">${unfolded.has(slot) ? '收起评审折叠的卡' : `评审折叠了 ${folded.length} 张（4 分及以下），点开看`}</button>` : ''}
        </div>
      </section>`
    })}`)
  drawRoundForm()
}

f.onChange(draw)
window.gugu.onContextChanged((next) => {
  if (next?.chat?.members) {
    members = next.chat.members
    draw()
  }
})
draw()
window.gugu.setTabTitle?.('抽卡台')?.catch?.((error) => say(`标题没改成：${error.message}`, 'error'))
