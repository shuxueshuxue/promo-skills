// 片场's archive: Studio opened in a chat on no file. Every *.studio.json of the chat is one project (one card table);
// they are listed here with where each stands, a new one is made here, and videos are uploaded into one (upload.js).
// Opening a project opens its table in Studio's own tab (app.js). Agents make projects with the new_project tool —
// they show here as they come, as the chat folder changes.
import { TABLE_SUFFIX, leadLabel, newTable, normalizeTable, projectFacts, projectName, tableFileName } from './model.js'
import { drawUploads, uploadInto } from './upload.js'

const $ = (selector) => document.querySelector(selector)
const ctx = await window.gugu.getContext()
const chat = ctx.chat?.id
const members = ctx.chat?.members ?? []
$('#archive').hidden = false
window.gugu.setTabTitle?.('片场')?.catch?.(() => {}) // a title is a nicety: a host without it still shows the page

function say(message) {
  $('#status').setAttribute('role', 'alert')
  $('#status').textContent = message
}
if (!chat) {
  say('片场的工程在群里：在一个群里打开片场。')
  throw new Error('Studio opened outside a chat')
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false))
  return node
}

// ─── the projects: each table open live while it is listed, so what changes on it (a card, a point) shows here ─────
const projects = new Map() // file id → { entry, f }
let listed = false
const time = (iso) => Date.parse(iso ?? '') || 0
const inOrder = () => [...projects.values()].sort((a, b) => time(a.entry.createdAt) - time(b.entry.createdAt))

// One listing at a time: the folder can change again while a listing still opens tables, and a table is opened once.
let listing = Promise.resolve()
const list = () => (listing = listing.then(listOnce, listOnce))
async function listOnce() {
  const entries = (await window.gugu.files.list({ chat })).filter((entry) => entry.type !== 'folder' && entry.name?.endsWith(TABLE_SUFFIX))
  const ids = new Set(entries.map((entry) => entry.id))
  for (const [id, project] of projects) {
    if (!ids.has(id)) {
      project.f.close()
      projects.delete(id)
    }
  }
  await Promise.all(entries.map(async (entry) => {
    const known = projects.get(entry.id)
    if (known) {
      known.entry = entry
      return
    }
    const f = await window.gugu.files.open(entry)
    // The same once-only fill the table does (model.js normalizeTable): a table from before 0.3.0 gets its lines.
    if (normalizeTable(structuredClone(f.toJSON()))) f.transact(() => normalizeTable(f.data))
    f.onChange(draw)
    projects.set(entry.id, { entry, f })
  }))
  listed = true
  draw()
}

// ─── pictures: a project's cover is a picked card's picture, else its latest video — read once, and its element kept, so
// a redraw (every change of any project) does not start a video over ─────────────────────────────────────────────────
const covers = new Map() // itemId → 'loading' | { node } | { error }
async function loadCover(itemId) {
  covers.set(itemId, 'loading')
  try {
    const file = await window.gugu.files.open({ chat, id: itemId })
    const blob = await file.blob()
    file.close()
    const url = URL.createObjectURL(blob)
    const video = /^video\//.test(blob.type) || /\.(mp4|mov|webm)$/i.test(file.entry.name)
    covers.set(itemId, { node: video ? el('video', { src: `${url}#t=1`, muted: true, preload: 'metadata' }) : el('img', { src: url, alt: '' }) })
  } catch (error) {
    covers.set(itemId, { error: error.message })
  }
  draw()
}
function coverView(itemId, facts) {
  const box = el('div', { className: 'cover' })
  const c = itemId && covers.get(itemId)
  if (itemId && !c) loadCover(itemId)
  if (c?.node) box.append(c.node)
  else if (!itemId || c?.error) {
    box.classList.add('empty')
    box.append(el('small', { textContent: c?.error ? '封面打不开' : '还没有视频' }))
  }
  const count = facts.picked ? `${facts.rounds} 轮 · ${facts.picked.kind}${facts.picked.version > 1 ? ` v${facts.picked.version}` : ''}` : facts.materials ? `${facts.materials} 个视频` : ''
  if (count) box.append(el('span', { className: 'count', textContent: count }))
  return box
}

const nameOf = (id, data) => members.find((m) => m.id === id)?.name ?? data.names?.[id] ?? '已退群的成员'
const pill = (text, tone = '') => el('span', { className: `pill ${tone}`, textContent: text })

function projectView({ entry, f }) {
  const data = f.toJSON()
  const facts = projectFacts(data)
  const by = data.lead ? leadLabel(nameOf(data.lead, data)) : entry.createdBy?.name ? `${entry.createdBy.name} 新建` : ''
  const updated = el('gugu-time')
  updated.setAttribute('datetime', entry.updatedAt ?? '')
  const avatar = el('gugu-avatar')
  avatar.setAttribute('size', 'xs')
  if (data.lead || entry.createdBy?.id) avatar.setAttribute('user', data.lead ?? entry.createdBy.id)
  const card = el('article', { className: 'card project', tabIndex: 0 },
    coverView(facts.cover, facts),
    el('div', { className: 'body' },
      el('h3', { textContent: projectName(entry.name) }),
      String(data.brief ?? '') ? el('span', { className: 'brief', textContent: String(data.brief) }) : null,
      el('span', { className: 'facts' },
        facts.picked ? pill(`${facts.picked.kind}${facts.picked.version > 1 ? ` v${facts.picked.version}` : ''} 已选`, 'ok') : null,
        facts.openPoints ? pill(`打点 ${facts.openPoints} 条待处理`, 'warn') : null,
        facts.materials ? pill(`素材 ${facts.materials} 个视频`) : null,
        facts.cards ? pill(`${facts.cards} 张卡`) : null,
        !facts.rounds && !facts.materials ? pill('还没开轮') : null)),
    el('div', { className: 'who' }, avatar, el('small', { className: 'grow', textContent: by }), el('small', { className: 'muted' }, '更新于 ', updated)))
  card.dataset.key = entry.id
  card.onclick = (event) => event.target.closest('button') || open(entry)
  card.onkeydown = (event) => { if (event.key === 'Enter') open(entry) }
  // A video dropped on a project goes into it.
  card.ondragover = (event) => { event.preventDefault(); card.classList.add('drop') }
  card.ondragleave = () => card.classList.remove('drop')
  card.ondrop = (event) => {
    event.preventDefault()
    card.classList.remove('drop')
    askWhere([...event.dataTransfer.files], entry.id)
  }
  return card
}

function open(entry) {
  window.gugu.files.openWith(entry, { tab: 'main' }).catch((error) => say(`打不开「${projectName(entry.name)}」：${error.message}`))
}

function draw() {
  const all = inOrder()
  $('#arch-sub').textContent = listed ? `这个群的工程 · ${all.length} 个。打开一个进入它的卡桌；把视频拖到某个工程上，就加进那个工程。` : '正在读取工程…'
  const box = $('#projects')
  if (listed && !all.length) {
    box.replaceChildren(el('gugu-empty', { innerHTML: '<strong>还没有工程</strong><small>新建一个，或者直接上传视频</small>' }))
  } else box.replaceChildren(...all.map(projectView))
  drawUploads($('#arch-tray'), (row) => {
    const project = inOrder().find((p) => projectName(p.entry.name) === row.project)
    if (project) open(project.entry)
  })
}

// ─── 新建工程 ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function makeProject(title, brief) {
  return window.gugu.files.create({ chat, name: tableFileName(title) }, newTable({ brief }))
}
$('#arch-new').onclick = () => {
  $('#np-title').value = ''
  $('#np-brief').value = ''
  $('#project-box').showModal()
}
$('#np-cancel').onclick = () => $('#project-box').close()
$('#np-make').onclick = async () => {
  const title = $('#np-title').value.trim()
  if (!title) return $('#np-title').focus()
  try {
    const entry = await makeProject(title, $('#np-brief').value.trim())
    $('#project-box').close()
    await list()
    open(entry)
  } catch (error) {
    say(`新建失败：${error.message}`)
  }
}

// ─── 上传视频: pick (or drop on a project), choose where, then each file goes up on its own ──────────────────────────
let picked = []
$('#arch-upload').onclick = () => $('#pick-videos').click()
$('#pick-videos').onchange = () => {
  askWhere([...$('#pick-videos').files])
  $('#pick-videos').value = ''
}
function askWhere(files, projectId) {
  picked = files.filter((file) => file.size >= 0)
  if (!picked.length) return
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
  $('#up-title').textContent = `上传 ${picked.length} 个视频`
  $('#up-files').replaceChildren(...picked.map((file) => el('li', {}, el('span', { className: 'grow', textContent: file.name }), el('small', { className: 'muted', textContent: mb(file.size) }))))
  const all = inOrder()
  $('#up-project').replaceChildren(...all.map(({ entry }) => el('option', { value: entry.id, textContent: projectName(entry.name), selected: entry.id === projectId })))
  $('#up-old').disabled = !all.length
  $('#up-project').disabled = !all.length
  $('#up-old').checked = Boolean(all.length)
  $('#up-new').checked = !all.length
  $('#up-name').value = picked[0].name.replace(/\.[^.]+$/, '')
  $('#upload-box').showModal()
}
$('#up-cancel').onclick = () => $('#upload-box').close()
$('#up-name').onfocus = () => { $('#up-new').checked = true }
$('#up-project').onchange = () => { $('#up-old').checked = true }
$('#up-start').onclick = async () => {
  const files = picked
  let target
  try {
    if ($('#up-new').checked) {
      const name = $('#up-name').value.trim()
      if (!name) return $('#up-name').focus()
      const entry = await makeProject(name, '')
      await list()
      target = projects.get(entry.id)
    } else target = projects.get($('#up-project').value)
    if (!target) throw new Error('这个工程已经不在了')
  } catch (error) {
    say(`没有上传：${error.message}`)
    return
  }
  $('#upload-box').close()
  await uploadInto(files, { chat, project: projectName(target.entry.name), table: target.f, by: target.f.presence.self.userId }, draw)
}

window.gugu.files.onChanged({ chat }, () => list().catch((error) => say(`工程列表读取失败：${error.message}`)))
draw()
await list().catch((error) => say(`工程列表读取失败：${error.message}`))
