// 抽卡台 — the card table. Several agents (different models, different harnesses) each hand in cards for a round; the
// people in the chat annotate them (批注 — an agent they ask to look annotates the same way), pick one or send one back for
// a new version. Picked cards are what the next round mixes. Review rules are promo-skills'
// (skills/promo-video/references/review-loop.md): reject or annotate, never "approve"; a reject is answered by a newer
// version of the card.
//
// The page is the project: its rounds as stages down a spine (one line the trunk, the others indented as branches), each
// stage a picked card's picture or an empty ring; the open stage's candidates beside it, each with its history as marks.
// Where the project stands is read from the shapes and their places — the page writes no progress words. Settings have
// their own view, behind the gear.
import { f, me, $, html, render } from '/_gugu/1/glue.js'
import { KINDS, TRACKS, drawHint, eventsOf, normalizeTable, pickOfRound, pickOf, roundsInOrder, slotOf, tracksInOrder } from './model.js'
import { IMAGE_MODEL, SETTINGS_FILE, parseSettings } from './settings.js'

const ctx = await window.gugu.getContext()
const md = await window.gugu.markdown()
const chatId = f.entry.chat ?? ctx.chat?.id
let members = ctx.chat?.members ?? []
const now = () => new Date().toISOString()
const newId = (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}`
// A member who left is no longer in the chat's members: the table keeps the names it has seen, so their cards still say who.
const nameOf = (id) => members.find((m) => m.id === id)?.name ?? f.data.names?.[id] ?? '已退群的成员'
const agents = () => members.filter((m) => m.kind === 'agent')

// The table made whole once (model.js normalizeTable): only what is missing is added, so pages and agents opening it at
// the same time agree. The brief is the page's own field.
if (normalizeTable(structuredClone(f.toJSON())) || f.data.brief === undefined) {
  f.transact(() => {
    normalizeTable(f.data)
    if (f.data.brief === undefined) f.data.brief = window.gugu.text('')
  })
}

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
function mediaView(itemId, cls = 'media') {
  const m = media.get(itemId)
  if (!m) {
    queueMicrotask(() => media.has(itemId) || loadMedia(itemId))
    return html`<div class="${cls}" data-key="${itemId}"></div>`
  }
  if (m === 'loading') return html`<div class="${cls}" data-key="${itemId}"></div>`
  if (m.error) return html`<small class="muted" data-key="${itemId}">${m.error}</small>`
  // A clip on the spine is a still: its frame at 5 s (a media fragment), no controls.
  if (m.kind === 'video' && cls !== 'media') return html`<video class="${cls}" data-key="${itemId}" src="${m.url}#t=5" muted playsinline preload="metadata"></video>`
  if (m.kind === 'video') return html`<video class="${cls}" data-key="${itemId}" src="${m.url}" controls muted playsinline preload="metadata"></video>`
  if (m.kind === 'audio') return html`<audio data-key="${itemId}" src="${m.url}" controls preload="metadata"></audio>`
  if (m.kind === 'text') return html`<pre data-key="${itemId}">${m.text}</pre>`
  return html`<img class="${cls}" data-key="${itemId}" src="${m.url}" alt="${m.name}" />`
}

// ─── the header: the file's name, the brief (typed in together), 开一轮, settings ──────────────────────────────────
$('#name').textContent = String(f.entry.name ?? '抽卡台').replace(/\.chouka\.json$/, '')
try {
  window.gugu.bind.text($('#brief'), f.textAt(['brief']))
} catch {
  // An agent wrote the brief as a plain string: shown, typed over as one value.
  $('#brief').value = String(f.data.brief ?? '')
  $('#brief').onchange = () => { f.data.brief = window.gugu.text($('#brief').value) }
}
const showSettings = (on) => {
  $('#project').hidden = on
  $('#settings').hidden = !on
  $('#bar').hidden = on
  if (on) loadSettings().catch((error) => say(`设置读不出来：${error.message}`, 'error'))
}
$('#open-settings').onclick = () => showSettings(true)
$('#back').onclick = () => showSettings(false)

// ─── settings.json in this App's own data folder: the image key and model (the image tool reads them) and the writers
// ticked by default — never in the shared table ──────────────────────────────────────────────────────────────────────
// A device that runs no programs (the phone) has no callProgram: its writers' images come from a computer.
const runsPrograms = typeof window.gugu.callProgram === 'function'
let settings = {}
async function readSettings() {
  settings = parseSettings(await window.gugu.readData(SETTINGS_FILE))
  return settings
}
/** Read the file again and change only what the person changed: an agent may have edited it meanwhile. */
async function saveSettings(change) {
  const next = change(parseSettings(await window.gugu.readData(SETTINGS_FILE)))
  await window.gugu.writeData(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`)
  settings = next
}
async function loadSettings() {
  await readSettings()
  drawWriters()
  for (const id of ['#img-key', '#img-model', '#img-save', '#img-clear']) $(id).disabled = !runsPrograms
  $('#img-model').placeholder = IMAGE_MODEL
  if (!runsPrograms) {
    $('#img-state').textContent = '在电脑上设置'
    return
  }
  const hasKey = Boolean(String(settings.openrouterKey ?? '').trim())
  $('#img-state').textContent = hasKey ? '已配置' : '还没有密钥'
  $('#img-key').placeholder = hasKey ? '已配置（要换就粘贴新的）' : '粘贴 OpenRouter 的 API 密钥'
  $('#img-model').value = settings.imageModel ?? ''
  if (hasKey) await checkImageKey()
}
async function checkImageKey() {
  $('#img-state').textContent = '正在试一次…'
  const result = await window.gugu.callProgram('check_image_key')
  if (!result) return // app_check's rehearsal runs no program
  const answer = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? '{}')
  if (result.isError || !answer.ok) $('#img-state').textContent = `不能用：${answer.reason ?? result.content?.[0]?.text ?? '?'}`
  else $('#img-state').textContent = `能用 · ${answer.remaining == null ? `余额读不到` : `可用余额 $${answer.remaining.toFixed(2)}`}`
  if (answer.settings) $('#img-where').textContent = `设置存在这台电脑上：${answer.settings}。`
}
$('#img-save').onclick = async () => {
  const key = $('#img-key').value.trim()
  const model = $('#img-model').value.trim()
  try {
    await saveSettings((s) => {
      const next = { ...s }
      if (key) next.openrouterKey = key
      if (model) next.imageModel = model
      else delete next.imageModel
      return next
    })
    $('#img-key').value = ''
    await loadSettings()
  } catch (error) {
    say(`没存上：${error.message}`, 'error')
  }
}
$('#img-clear').onclick = async () => {
  try {
    await saveSettings((s) => {
      const next = { ...s }
      delete next.openrouterKey
      return next
    })
    await loadSettings()
  } catch (error) {
    say(`没清掉：${error.message}`, 'error')
  }
}
function drawWriters() {
  const ticked = new Set(settings.writers ?? [])
  const list = agents()
  render($('#writers'), list.length
    ? html`${list.map((a) => html`<label data-key="${a.id}"><input type="checkbox" data-writer="${a.id}" ${ticked.has(a.id) ? html`checked` : ''} /> <gugu-avatar user="${a.id}" size="xs"></gugu-avatar> ${a.name}</label>`)}`
    : html`<small class="muted">这个对话里还没有 Agent。</small>`)
}
$('#writers').addEventListener('change', async (event) => {
  const id = event.target.dataset?.writer
  if (!id) return
  try {
    await saveSettings((s) => {
      const writers = new Set(s.writers ?? [])
      if (event.target.checked) writers.add(id)
      else writers.delete(id)
      return { ...s, writers: [...writers] }
    })
  } catch (error) {
    say(`没存上：${error.message}`, 'error')
  }
})
readSettings().catch((error) => say(`设置读不出来：${error.message}`, 'error'))

// ─── 开一轮: a dialog; the line is chosen here (a new one can be started) ──────────────────────────────────────────
$('#r-kind').innerHTML = KINDS.map((k) => `<option>${k}</option>`).join('')
const NEW_TRACK = '\u0000new'
const chosenAgents = new Set()
const pickedCards = () => {
  const slots = new Set(Object.values(f.data.cards).map((card) => slotOf(f.data, card)))
  return [...slots].map((slot) => pickOf(f.data, slot)).filter(Boolean).map((id) => [id, f.data.cards[id]])
}
function drawRoundForm() {
  const list = agents()
  render($('#r-agents'), list.length
    ? html`${list.map((a) => html`<label data-key="${a.id}"><input type="checkbox" data-agent="${a.id}" ${chosenAgents.has(a.id) ? html`checked` : ''} /> <gugu-avatar user="${a.id}" size="xs"></gugu-avatar> ${a.name}</label>`)}`
    : html`<small class="muted">这个对话里还没有 Agent：先把几个不同模型的 Agent 拉进来。</small>`)
  const picked = pickedCards()
  $('#r-refs').textContent = picked.length ? `参考（已选的卡）：${picked.map(([, c]) => c.title).join('、')}` : ''
}
$('#open-round').onclick = () => {
  const lines = [...new Set([...tracksInOrder(f.data).map((t) => t.name), ...TRACKS])]
  const current = f.data.rounds[openRound]?.track ?? lines[0]
  $('#r-track').innerHTML = [...lines.map((t) => `<option ${t === current ? 'selected' : ''}>${t.replace(/[<&]/g, '')}</option>`), `<option value="${NEW_TRACK}">新的一条…</option>`].join('')
  $('#r-new-track-label').hidden = true
  chosenAgents.clear()
  for (const id of settings.writers ?? []) chosenAgents.add(id)
  drawRoundForm()
  $('#round-box').showModal()
}
$('#r-track').onchange = () => { $('#r-new-track-label').hidden = $('#r-track').value !== NEW_TRACK }
$('#r-cancel').onclick = () => $('#round-box').close()
$('#r-agents').addEventListener('change', (event) => {
  const id = event.target.dataset?.agent
  if (!id) return
  if (event.target.checked) chosenAgents.add(id)
  else chosenAgents.delete(id)
})
$('#r-start').onclick = async () => {
  const chosen = [...chosenAgents].filter((id) => agents().some((a) => a.id === id))
  if (!chosen.length) return say('先勾上至少一个 Agent', 'error')
  const track = $('#r-track').value === NEW_TRACK ? $('#r-new-track').value.trim() : $('#r-track').value
  if (!track) return say('给新的线起个名字', 'error')
  const kind = $('#r-kind').value
  const slot = $('#r-slot').value.trim() || kind
  const each = Math.max(1, Math.min(5, Number($('#r-each').value) || 1))
  const n = Object.keys(f.data.rounds).length + 1
  const id = newId('r')
  openRound = id // before the write: writing the round redraws, and the new stage is the one to show
  f.data.rounds[id] = { n, track, kind, slot, ask: $('#r-ask').value.trim(), each, agents: chosen, refs: pickedCards().map(([cardId]) => cardId), by: me, at: now() }
  $('#r-ask').value = ''
  $('#r-slot').value = ''
  $('#round-box').close()
  say(`第 ${n} 轮开始了：叫了 ${chosen.map(nameOf).join('、')}`)
  for (const agent of chosen) await tell(agent, `抽卡台第 ${n} 轮：${slot}（${kind}），每人 ${each} 张。先用抽卡台的 board 工具读卡桌（要求和参考都在那里），每张卡用 submit 交。${drawHint(kind)}`)
}

// ─── 批注: one dialog, drawn once. Ticking 「要作者交新版」 makes it a reject (the author is asked for a new version) ───────
let pending = null // the card id
function ask(cardId) {
  pending = cardId
  $('#say-title').textContent = `批注：${f.data.cards[cardId]?.title ?? ''}`
  $('#say-text').value = ''
  $('#say-reject').checked = false
  $('#say-rule').checked = false
  drawSayBox()
  $('#say-box').showModal()
}
function drawSayBox() {
  const reject = $('#say-reject').checked
  $('#say-send').textContent = reject ? '打回并批注' : '提交批注'
  $('#say-send').classList.toggle('danger', reject)
  $('#say-send').classList.toggle('primary', !reject)
  $('#say-reject-row').classList.toggle('on', reject)
}
$('#say-reject').onchange = drawSayBox
$('#say-cancel').onclick = () => $('#say-box').close()
$('#say-send').onclick = async () => {
  const comment = $('#say-text').value.trim()
  const verdict = $('#say-reject').checked ? 'reject' : 'note'
  if (!pending || (!comment && verdict === 'note')) return
  const cardId = pending
  const id = newId('f')
  f.transact(() => {
    f.data.feedback[id] = { card: cardId, verdict, comment, who: me, ts: now() }
    if ($('#say-rule').checked && comment) f.data.rules[newId('rule')] = { text: comment, from: id, by: me, at: now() }
  })
  $('#say-box').close()
  // Only a reject wakes the author: it asks for a new version. A 批注 asks nothing — the author reads it on the table
  // (waking an agent author for it is a whole turn of its model for nothing to do).
  const card = f.data.cards[cardId]
  if (verdict === 'reject') await tell(card?.by, `「${card?.title}」被打回了：用抽卡台的 board 工具看批注，再用 submit（带上 card）交新一版。${drawHint(card?.kind)}`)
}

// ─── the project: spine and stage ───────────────────────────────────────────────────────────────────────────────────
let openRound = null // the stage shown; the latest one until a person picks another
let shownRound = null // the stage last scrolled into view on the spine
let askOpen = false // the open stage's request shown in full (three lines until clicked)
const opened = new Set() // cards whose text and pictures are shown in full
const histories = new Set() // cards whose history is unfolded
const MARK = { version: 'v', note: 'n', reject: 'r', pick: 'p' }
const marks = (events) => html`<span class="marks">${events.map((e) => html`<i class="mark ${MARK[e.kind] ?? 'n'}"></i>`)}</span>`
const money = (usd) => (usd ? `$${usd.toFixed(usd < 1 ? 3 : 2)}` : '')
const seconds = (s) => (s >= 90 ? `${Math.round(s / 60)} 分钟` : s ? `${Math.round(s)} 秒` : '')

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-act]')
  if (!el) return
  const { act, card, round } = el.dataset
  // render keeps the focused element as it is, and a click focuses the node — so step out, redraw, step back in.
  if (act === 'stage') { openRound = round; askOpen = false; el.blur(); draw(); el.focus({ preventScroll: true }) }
  else if (act === 'pick') f.data.feedback[newId('f')] = { card, verdict: 'pick', who: me, ts: now() }
  else if (act === 'note') ask(card)
  else if (act === 'open') { opened.has(card) ? opened.delete(card) : opened.add(card); draw() }
  else if (act === 'history') { histories.has(card) ? histories.delete(card) : histories.add(card); draw() }
  else if (act === 'first-round') $('#open-round').click()
  else if (act === 'ask') { askOpen = !askOpen; draw() }
})

function spineView(data) {
  const tracks = tracksInOrder(data)
  const trunk = tracks[0]?.name
  let previous = null // the line of the node before: where it changes, the strip (a narrow panel) draws a divider
  return html`${roundsInOrder(data).map(([id, round]) => {
    const lineStart = previous !== null && round.track !== previous
    previous = round.track
    const pick = pickOfRound(data, id)
    const card = pick ? data.cards[pick] : null
    const dot = card
      ? (card.files?.length ? html`<span class="dot">${mediaView(card.files[0], 'dot-media')}</span>` : html`<span class="dot chosen"></span>`)
      : html`<span class="dot empty"></span>`
    const cards = Object.entries(data.cards).filter(([, c]) => c.round === id)
    return html`<button class="node ${round.track === trunk ? '' : 'branch'} ${lineStart ? 'line-start' : ''}" data-line="${round.track}" data-key="${id}" data-act="stage" data-round="${id}" aria-current="${id === openRound ? 'step' : 'false'}">
      ${dot}
      <span class="node-text"><span class="node-slot">${round.slot}</span><small class="muted node-pick">${card?.title ?? ''}</small>
        <span class="tally">${cards.map(([cid]) => html`<i class="${cid === pick ? 'on' : eventsOf(data, cid).some((e) => e.kind === 'reject') ? 'x' : ''}"></i>`)}</span></span>
    </button>`
  })}`
}

function historyView(data, cardId) {
  const events = eventsOf(data, cardId)
  return html`<ol class="history">${events.map((e, i) => {
    const what = e.kind === 'version' ? `交第 ${e.version} 版` : e.kind === 'pick' ? '选了这张' : e.kind === 'reject' ? '打回' : '批注'
    const who = e.kind === 'version' ? nameOf(data.cards[cardId].by) : nameOf(e.who)
    return html`<li data-key="${cardId}:${i}"><i class="mark ${MARK[e.kind] ?? 'n'}"></i><div>
      <span><strong>${who}</strong> ${what}</span> <gugu-time datetime="${e.at}"></gugu-time>
      ${e.comment ? html`<p>${e.comment}</p>` : ''}
      ${e.kind === 'version' && e.lost ? html`<p class="muted">这一版的正文没留下：0.3.0 以前，交新版会直接盖掉旧版。</p>` : ''}
      ${e.kind === 'version' && !e.lost && e.version < (data.cards[cardId].version ?? 1) ? html`<details><summary>这一版写的</summary><p class="kept">${e.saved?.title ?? ''}${'\n'}${e.saved?.text ?? ''}</p></details>` : ''}
    </div></li>`
  })}</ol>`
}

function cardView(data, id, card, pick) {
  const events = eventsOf(data, id)
  const isPicked = id === pick
  const cost = [money(card.cost?.usd), seconds(card.cost?.seconds)].filter(Boolean).join(' · ')
  const files = card.files ?? []
  return html`<article class="card chouka-card ${isPicked ? 'picked' : ''}" data-key="${id}">
    ${files.length ? html`<div class="pics">${(opened.has(id) ? files : files.slice(0, 1)).map((itemId) => mediaView(itemId))}${!opened.has(id) && files.length > 1 ? html`<small class="more">+${files.length - 1}</small>` : ''}</div>` : ''}
    <strong>${card.title}${(card.version ?? 1) > 1 ? html` <small class="muted">v${card.version}</small>` : ''}</strong>
    <small class="muted"><gugu-avatar user="${card.by}" size="xs"></gugu-avatar> ${nameOf(card.by)}${card.model ? ` · ${card.model}` : ''}${cost ? ` · ${cost}` : ''}</small>
    ${card.text ? html`<div class="text ${opened.has(id) ? 'open' : ''}" data-md="${id}"></div>` : ''}
    ${(card.text && card.text.length > 160) || files.length > 1 ? html`<button class="sm" data-act="open" data-card="${id}">${opened.has(id) ? '收起' : '展开'}</button>` : ''}
    <button class="marks-btn" data-act="history" data-card="${id}" aria-expanded="${histories.has(id)}" aria-label="经过">${marks(events)}</button>
    ${histories.has(id) ? historyView(data, id) : ''}
    <div class="row">
      ${isPicked ? '' : html`<button data-act="pick" data-card="${id}">选这张</button>`}
      <button data-act="note" data-card="${id}">批注</button>
    </div>
  </article>`
}

function stageView(data) {
  const round = data.rounds[openRound]
  if (!round) return html`<gugu-empty icon="checklist"><strong>还没有卡</strong><small>写好需求，开第一轮</small><button class="primary" data-act="first-round">开一轮</button></gugu-empty>`
  const pick = pickOfRound(data, openRound)
  const cards = Object.entries(data.cards).filter(([, c]) => c.round === openRound)
    .sort(([a, x], [b, y]) => (b === pick) - (a === pick) || (x.at ?? '').localeCompare(y.at ?? ''))
  return html`<header class="stage-head" data-key="head:${openRound}">
      <h2>${round.slot}</h2>
      <span class="writers">${(round.agents ?? []).map((a) => html`<gugu-avatar user="${a}" size="xs"></gugu-avatar>`)}</span>
    </header>
    ${round.ask ? html`<p class="muted ask ${askOpen ? 'open' : ''}" data-act="ask">${round.ask}</p>` : ''}
    <div class="cards">${cards.map(([id, card]) => cardView(data, id, card, pick))}</div>`
}

function draw() {
  const data = f.data
  if (!openRound || !data.rounds[openRound]) openRound = roundsInOrder(data).at(-1)?.[0] ?? null
  render($('#spine'), spineView(data))
  render($('#stage'), stageView(data))
  const rules = Object.values(data.rules).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  render($('#rules'), html`<small class="muted">底子是 promo-video skill 里 director-rulings.md 的 23 条；下面是在这张卡桌上被打回后升上来的${rules.length ? '' : '（还没有）'}。</small>
    <ol start="24">${rules.map((r) => html`<li data-key="${r.from}">${r.text}</li>`)}</ol>`)
  // The open stage in view on the spine (a strip in a narrow panel scrolls), once each time it changes.
  if (openRound !== shownRound) {
    shownRound = openRound
    document.querySelector('.node[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  if ($('#round-box').open) drawRoundForm()
  if (!$('#settings').hidden) drawWriters()
  // A card's text is markdown, drawn with gugu's own renderer — again after every render, which empties these boxes.
  for (const box of document.querySelectorAll('[data-md]')) md.render(box, data.cards[box.dataset.md]?.text ?? '')
}

function rememberNames() {
  const changed = members.filter((m) => m.name && f.data.names[m.id] !== m.name)
  if (changed.length) f.transact(() => { for (const m of changed) f.data.names[m.id] = m.name })
}
f.onChange(draw)
window.gugu.onContextChanged((next) => {
  if (next?.chat?.members) {
    members = next.chat.members
    rememberNames()
    draw()
  }
})
rememberNames()
draw()
window.gugu.setTabTitle?.('抽卡台')?.catch?.((error) => say(`标题没改成：${error.message}`, 'error'))
