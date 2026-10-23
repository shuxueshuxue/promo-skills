// 片场 (Studio) — the card table. Several agents (different models, different harnesses) each hand in cards for a round; the
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
import { KINDS, TRACKS, addRound, cardClass, checkLine, coverOf, drawHint, eventsOf, leadLabel, leadToWake, limitsOf, marksWords, money, roundCall, waitingRound, normalizeTable, pickOfRound, pickOf, roundsInOrder, slotOf, spendOf, tracksInOrder, withBreaks } from './model.js'
import { IMAGE_MODEL, SETTINGS_FILE, VOICES, parseSettings } from './settings.js'

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
    await window.gugu.send(to, text, { refs: [{ file: f.entry }] })
  } catch (error) {
    say(`通知 ${nameOf(to)} 失败：${error.code ?? ''} ${error.message}`, 'error')
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
    media.set(itemId, { error: `文件打开失败：${error.message}` })
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

// ─── a clip's original: it stays in the working copy of the session that made it (cards[].video.at), opened on demand ──
// Keyed by the clip itself (its sha256, else where it is), never by the card: a new version of the card brings a new
// clip, and the page plays that one — not the one it played before the reject.
const originals = new Map() // clip key → 'loading' | { url, changed } | { error }
const shown = new Map() // cardId → the clip key it last showed (its object URL goes when the card moves on)
const clipKey = (video) => video.sha256 || `${video.at.session}/${video.at.path}`
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
async function loadOriginal(cardId, video) {
  const key = clipKey(video)
  originals.set(key, 'loading')
  draw()
  let file = null
  try {
    file = await window.gugu.files.open({ session: video.at.session, name: video.at.path }, { readOnly: true })
    const blob = await file.blob()
    const sha = video.sha256 ? hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())) : null
    originals.set(key, { url: URL.createObjectURL(blob), changed: Boolean(sha && sha !== video.sha256) })
  } catch (error) {
    const why = error.code === 'not-found'
      ? `未找到原片：请检查提交任务的工作区和文件（${error.message}）`
      : `原片打开失败：${error.message}`
    originals.set(key, { error: why })
  } finally {
    file?.close()
  }
  draw()
  // It was asked for with a click: it plays. A refusal (no gesture left after a slow read) leaves its controls to click.
  if (originals.get(key)?.url) document.querySelector(`video[data-key="original:${CSS.escape(key)}"]`)?.play().catch(() => {})
}
const megabytes = (bytes) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '')
function videoView(cardId, video, open) {
  const key = clipKey(video)
  const before = shown.get(cardId)
  if (before && before !== key) {
    // The card has a new clip: the old one's bytes are let go.
    const old = originals.get(before)
    if (old?.url) URL.revokeObjectURL(old.url)
    originals.delete(before)
  }
  shown.set(cardId, key)
  const original = originals.get(key)
  const facts = [video.seconds ? `${Math.round(video.seconds * 10) / 10} 秒` : '', video.width && video.height ? `${video.width}×${video.height}` : '', megabytes(video.bytes)].filter(Boolean).join(' · ')
  // The original, once here, takes the cover's place: one picture on the card, the one that plays (trial 10-12: both).
  return html`${original?.url ? '' : html`<div class="pics">${mediaView(video.cover)}</div>`}
    ${open && video.strip ? html`<div class="strip">${mediaView(video.strip)}</div>` : ''}
    ${original?.url ? html`<video class="media" data-key="original:${key}" src="${original.url}" controls playsinline preload="metadata"></video>` : ''}
    ${original?.changed ? html`<small class="muted" role="alert">原片已修改，与提交时的版本不一致。</small>` : ''}
    ${original?.error ? html`<small class="muted" role="alert">${original.error}</small>` : ''}
    <small class="muted">原片${facts ? ` ${facts}` : ''}，保存在提交设备上；云端保存封面和缩略条。</small>
    ${video.check ? html`<small class="muted">提交检查：${checkLine(video.check)}</small>` : ''}
    ${original?.url ? '' : html`<button class="sm" data-act="original" data-card="${cardId}" ${original === 'loading' ? 'disabled' : ''}>${original === 'loading' ? '正在加载原片…' : '播放原片'}</button>`}`
}

// ─── the header: the brief (typed in together), 开一轮, settings ──────────────────────────────────
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
  for (const row of ['#bar', '#lead-row', '#spend']) $(row).hidden = on
  if (on) {
    drawLimits()
    loadSettings().catch((error) => say(`设置读取失败：${error.message}`, 'error'))
  }
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
  for (const id of ['#img-key', '#img-model', '#img-save', '#img-clear', '#voice']) $(id).disabled = !runsPrograms
  $('#img-model').placeholder = IMAGE_MODEL
  render($('#voice'), html`${VOICES.map((v) => html`<option value="${v}">${v}</option>`)}`)
  $('#voice').value = VOICES.includes(settings.voice) ? settings.voice : VOICES[0]
  if (!runsPrograms) {
    $('#img-state').textContent = '在电脑上设置'
    return
  }
  const hasKey = Boolean(String(settings.openrouterKey ?? '').trim())
  $('#img-state').textContent = hasKey ? '已配置' : '未配置密钥'
  $('#img-key').placeholder = hasKey ? '已配置，输入新密钥以替换' : '输入 OpenRouter API 密钥'
  $('#img-model').value = settings.imageModel ?? ''
  if (hasKey) await checkImageKey()
}
async function checkImageKey() {
  $('#img-state').textContent = '正在检查…'
  const result = await window.gugu.callProgram('check_image_key')
  if (!result) return // app_check's rehearsal runs no program
  const answer = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? '{}')
  if (result.isError || !answer.ok) $('#img-state').textContent = `检查失败：${answer.reason ?? result.content?.[0]?.text ?? '?'}`
  else $('#img-state').textContent = `可用 · ${answer.remaining == null ? `余额暂不可用` : `可用余额 $${answer.remaining.toFixed(2)}`}`
  if (answer.settings) $('#img-where').textContent = '设置仅保存在当前设备。'
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
    say(`保存失败：${error.message}`, 'error')
  }
}
$('#voice').onchange = async () => {
  const voice = $('#voice').value
  try {
    await saveSettings((s) => ({ ...s, voice }))
  } catch (error) {
    say(`保存失败：${error.message}`, 'error')
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
    say(`清除失败：${error.message}`, 'error')
  }
}
function drawWriters() {
  const ticked = new Set(settings.writers ?? [])
  const list = agents()
  render($('#writers'), list.length
    ? html`${list.map((a) => html`<label data-key="${a.id}"><input type="checkbox" data-writer="${a.id}" ${ticked.has(a.id) ? html`checked` : ''} /> <gugu-avatar user="${a.id}" size="xs"></gugu-avatar> ${a.name}</label>`)}`
    : html`<small class="muted">当前群聊暂无 Agent。</small>`)
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
    say(`保存失败：${error.message}`, 'error')
  }
})
readSettings().catch((error) => say(`设置读取失败：${error.message}`, 'error'))

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
    : html`<small class="muted">请先向群聊添加使用不同模型的 Agent。</small>`)
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
  const id = newId('r')
  openRound = id // before the write: writing the round redraws, and the new stage is the one to show
  following = true
  // The same way the lead's open_round puts a round on the table.
  const n = addRound(f.data, { id, track, kind, slot, ask: $('#r-ask').value.trim(), each, agents: chosen, refs: pickedCards().map(([cardId]) => cardId) }, me, now())
  $('#r-ask').value = ''
  $('#r-slot').value = ''
  $('#round-box').close()
  say(`第 ${n} 轮已开始，已通知 ${chosen.map(nameOf).join('、')}`)
  for (const agent of chosen) await tell(agent, roundCall({ n, slot, kind, each }))
}

// ─── the lead: woken when the person picks or skips (the next round is its to open), paused and handed back ──────
function wakeLead(text) {
  const lead = leadToWake(f.data)
  if (lead) tell(lead, text)
}
function picked(cardId) {
  const card = f.data.cards[cardId]
  const round = f.data.rounds[card?.round]
  wakeLead(`片场第 ${round?.n} 轮「${round?.slot}」选好了：「${card?.title}」。用 board 看看，再按计划用 open_round 开下一轮；计划走完了，就在群里跟人说一句片子做好了。`)
}
function skipped(roundId) {
  const round = f.data.rounds[roundId]
  if (!round) return
  round.skipped = true
  wakeLead(`片场第 ${round.n} 轮「${round.slot}」人跳过了，不挑。按计划用 open_round 开下一轮。`)
}
function takeOverOrHandBack() {
  if (f.data.paused) {
    f.data.paused = false
    tell(f.data.lead, '片场：人把卡桌交还给你了。先用 board 看看现在的样子，再接着按计划开轮（open_round）。')
  } else f.data.paused = true
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
  if (verdict === 'reject') await tell(card?.by, `「${card?.title}」被打回了：用片场的 board 工具看批注，再用 submit（带上 card）交新一版。${drawHint(card?.kind)}`)
}

// ─── the project: spine and stage ───────────────────────────────────────────────────────────────────────────────────
let openRound = null // the stage shown
// The stage shown follows the newest round — a round the lead opens comes into view by itself (trial 10-12: after a pick
// the table stayed on the round just picked). A person opening an older stage stops it; picking or skipping starts it again.
let following = true
let shownRound = null // the stage last scrolled into view on the spine
let askOpen = false // the open stage's request shown in full (three lines until clicked)
const opened = new Set() // cards whose text and pictures are shown in full
const histories = new Set() // cards whose history is unfolded
const MARK = { version: 'v', note: 'n', reject: 'r', pick: 'p' }
const marks = (events) => html`<span class="marks">${events.map((e) => html`<i class="mark ${MARK[e.kind] ?? 'n'}"></i>`)}</span>`
const seconds = (s) => (s >= 90 ? `${Math.round(s / 60)} 分钟` : s ? `${Math.round(s)} 秒` : '')

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-act]')
  if (!el) return
  const { act, card, round } = el.dataset
  if (act === 'stage') { openRound = round; following = round === roundsInOrder(f.data).at(-1)?.[0]; askOpen = false; draw() }
  else if (act === 'pick') { following = true; f.data.feedback[newId('f')] = { card, verdict: 'pick', who: me, ts: now() }; picked(card) }
  else if (act === 'skip') { following = true; skipped(round) }
  else if (act === 'lead') takeOverOrHandBack()
  else if (act === 'note') ask(card)
  else if (act === 'open') { opened.has(card) ? opened.delete(card) : opened.add(card); draw() }
  else if (act === 'history') { histories.has(card) ? histories.delete(card) : histories.add(card); draw() }
  else if (act === 'first-round') $('#open-round').click()
  else if (act === 'ask') { askOpen = !askOpen; draw() }
  else if (act === 'original') { const video = f.data.cards[card]?.video; if (video) loadOriginal(card, { ...video, at: { ...video.at } }) }
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
      ? (coverOf(card) ? html`<span class="dot">${mediaView(coverOf(card), 'dot-media')}</span>` : html`<span class="dot chosen"></span>`)
      : html`<span class="dot empty"></span>`
    const cards = Object.entries(data.cards).filter(([, c]) => c.round === id)
    return html`<button class="node ${round.track === trunk ? '' : 'branch'} ${lineStart ? 'line-start' : ''}" data-line="${round.track}" data-key="${id}" data-act="stage" data-round="${id}" aria-current="${id === openRound ? 'step' : 'false'}">
      ${dot}
      <span class="node-text"><span class="node-slot">${round.slot}</span><small class="muted node-pick">${card?.title ?? ''}</small>
        <span class="tally">${cards.map(([cid]) => html`<i class="${cid === pick ? 'on' : eventsOf(data, cid).some((e) => e.kind === 'reject') ? 'x' : ''}"></i>`)}</span></span>
    </button>`
  })}${(data.lead ? data.plan ?? [] : []).map((step, i) => html`<div class="node planned" data-key="plan:${i}:${step.slot}">
      <span class="dot planned"></span>
      <span class="node-text"><span class="node-slot">${step.slot}</span><small class="muted">计划</small></span>
    </div>`)}`
}

/** The lead's limits in the settings view: the table's own, over the defaults; a box being typed in is left alone. */
function drawLimits() {
  const limits = limitsOf(f.data)
  for (const [box, key] of [['#lim-rounds', 'rounds'], ['#lim-writers', 'writers']]) {
    if (document.activeElement !== $(box)) $(box).value = String(limits[key])
  }
}
for (const [box, key] of [['#lim-rounds', 'rounds'], ['#lim-writers', 'writers']]) {
  $(box).addEventListener('change', () => {
    const value = Math.round(Number($(box).value))
    if (!(value >= 1)) return drawLimits()
    f.data.limits = { ...limitsOf(f.data), [key]: value }
  })
}

/** The lead and what it is doing, with the person's hand on it: pause (take over) or hand back. Empty without a lead. */
function leadView(data) {
  if (!data.lead) return ''
  const waiting = waitingRound(data)
  const status = data.paused
    ? '已暂停，由你接管'
    : waiting
      ? `等待选择第 ${waiting.n} 轮「${waiting.slot}」的方案，可跳过本轮`
      : data.plan?.length
        ? `下一轮：${data.plan[0].slot}`
        : '计划已完成'
  return html`<gugu-avatar user="${data.lead}" size="xs"></gugu-avatar>
    <span>${leadLabel(nameOf(data.lead))}：${status}</span>
    <button class="sm" data-act="lead">${data.paused ? '交还组长' : '暂停组长'}</button>`
}

function historyView(data, cardId) {
  const events = eventsOf(data, cardId)
  return html`<ol class="history">${events.map((e, i) => {
    const what = e.kind === 'version' ? `交第 ${e.version} 版` : e.kind === 'pick' ? '选了这张' : e.kind === 'reject' ? '打回' : '批注'
    const who = e.kind === 'version' ? nameOf(data.cards[cardId].by) : nameOf(e.who)
    return html`<li data-key="${cardId}:${i}"><i class="mark ${MARK[e.kind] ?? 'n'}"></i><div>
      <span><strong>${who}</strong> ${what}</span> <gugu-time datetime="${e.at}"></gugu-time>
      ${e.comment ? html`<p>${e.comment}</p>` : ''}
      ${e.kind === 'version' && e.lost ? html`<p class="muted">此版本正文未保留：0.3.0 以前提交新版会覆盖旧版。</p>` : ''}
      ${e.kind === 'version' && !e.lost && e.version < (data.cards[cardId].version ?? 1) ? html`<details><summary>版本内容</summary><p class="kept">${e.saved?.title ?? ''}${'\n'}${withBreaks(e.saved?.text)}</p></details>` : ''}
    </div></li>`
  })}</ol>`
}

function cardView(data, id, card, pick) {
  const events = eventsOf(data, id)
  const isPicked = id === pick
  const cost = [money(card.cost?.usd), seconds(card.cost?.seconds)].filter(Boolean).join(' · ')
  const files = card.files ?? []
  return html`<article class="${cardClass(isPicked)}" data-key="${id}">
    ${card.video ? videoView(id, card.video, opened.has(id)) : ''}
    ${files.length ? html`<div class="pics">${(opened.has(id) ? files : files.slice(0, 1)).map((itemId) => mediaView(itemId))}${!opened.has(id) && files.length > 1 ? html`<small class="more">+${files.length - 1}</small>` : ''}</div>` : ''}
    <strong>${card.title}${(card.version ?? 1) > 1 ? html` <small class="muted">v${card.version}</small>` : ''}</strong>
    <small class="muted"><gugu-avatar user="${card.by}" size="xs"></gugu-avatar> ${nameOf(card.by)}${card.model ? ` · ${card.model}` : ''}${cost ? ` · ${cost}` : ''}</small>
    ${card.text ? html`<div class="text ${opened.has(id) ? 'open' : ''}" data-md="${id}"></div>` : ''}
    ${(card.text && card.text.length > 160) || files.length > 1 || card.video?.strip ? html`<button class="sm" data-act="open" data-card="${id}">${opened.has(id) ? '收起' : '展开'}</button>` : ''}
    <button class="marks-btn" data-act="history" data-card="${id}" aria-expanded="${histories.has(id)}"><small class="muted">经过：${marksWords(events, isPicked)}</small>${marks(events)}</button>
    ${histories.has(id) ? historyView(data, id) : ''}
    <div class="row">
      ${isPicked ? '' : html`<button data-act="pick" data-card="${id}">选这张</button>`}
      <button data-act="note" data-card="${id}">批注</button>
    </div>
  </article>`
}

function stageView(data) {
  const round = data.rounds[openRound]
  if (!round) return html`<gugu-empty icon="checklist"><strong>暂无方案</strong><small>填写需求后创建第一轮</small><button class="primary" data-act="first-round">新建轮次</button></gugu-empty>`
  const pick = pickOfRound(data, openRound)
  const cards = Object.entries(data.cards).filter(([, c]) => c.round === openRound)
    .sort(([a, x], [b, y]) => (b === pick) - (a === pick) || (x.at ?? '').localeCompare(y.at ?? ''))
  // Who opened it: with a lead at the table, the rounds it opened and the ones the person did are told apart.
  const opener = data.lead ? (round.by === data.lead ? '组长创建' : round.by === me ? '你创建' : `${nameOf(round.by)} 创建`) : ''
  const canSkip = data.lead && !pick && !round.skipped
  return html`<header class="stage-head" data-key="head:${openRound}">
      <h2>${round.slot}</h2>
      <span class="writers">${(round.agents ?? []).map((a) => html`<gugu-avatar user="${a}" size="xs"></gugu-avatar>`)}</span>
      ${opener ? html`<small class="muted">${opener}${round.skipped ? ' · 已跳过' : ''}</small>` : ''}
      ${canSkip ? html`<button class="sm" data-act="skip" data-round="${openRound}">跳过这一轮</button>` : ''}
    </header>
    ${round.ask ? html`<p class="muted ask ${askOpen ? 'open' : ''}" data-act="ask">${round.ask}</p>` : ''}
    <div class="cards">${cards.map(([id, card]) => cardView(data, id, card, pick))}</div>`
}

/** What the table has cost so far, by the App's own tools — empty until something was paid for. */
function spendLine(data) {
  const { total, byTool, unknown } = spendOf(data)
  if (!total && !unknown) return ''
  const parts = [['voice', '配音'], ['image', '出图']].filter(([tool]) => byTool[tool]).map(([tool, name]) => `${name} ${money(byTool[tool])}`)
  return `已用 ${money(total) || '$0'}${parts.length ? `（${parts.join(' · ')}）` : ''}${unknown ? `，另有 ${unknown} 笔待结算` : ''}`
}

function draw() {
  const data = f.data
  if (following || !openRound || !data.rounds[openRound]) openRound = roundsInOrder(data).at(-1)?.[0] ?? null
  render($('#spine'), spineView(data))
  render($('#stage'), stageView(data))
  $('#spend').textContent = spendLine(data)
  render($('#lead-row'), leadView(data))
  const rules = Object.values(data.rules).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  render($('#rules'), html`<small class="muted">基础规则见 promo-video skill 的 director-rulings.md，共 23 条。以下为本项目新增规则${rules.length ? '' : '（暂无）'}。</small>
    <ol start="24">${rules.map((r) => html`<li data-key="${r.from}">${r.text}</li>`)}</ol>`)
  // The open stage in view on the spine (a strip in a narrow panel scrolls), once each time it changes.
  if (openRound !== shownRound) {
    shownRound = openRound
    document.querySelector('.node[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  if ($('#round-box').open) drawRoundForm()
  if (!$('#settings').hidden) {
    drawWriters()
    drawLimits()
  }
  // A card's text is markdown, drawn with gugu's own renderer — again after every render, which empties these boxes.
  for (const box of document.querySelectorAll('[data-md]')) md.render(box, withBreaks(data.cards[box.dataset.md]?.text))
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
window.gugu.setTabTitle?.(String(f.entry.name ?? '片场').replace(/\.studio\.json$/, ''))?.catch?.((error) => say(`标题更新失败：${error.message}`, 'error'))
