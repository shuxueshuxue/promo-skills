#!/usr/bin/env node
// promo-skills review board — multi-page, zero-dependency, zero client-side polling (never flickers).
// 评审台 v2：多页站，零依赖、零客户端轮询（绝不抽搐）。
// PRODUCT name shown in the UI is configurable: set env PROMO_TITLE (default "promo").
// 首页 = 分类成果索引（每项专属 URL）；详情页才有交互（视频/音频 + 批注表单）。
// 反馈 POST /api/feedback → review/feedback.jsonl（Claude Monitor 盯着）。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT || 7799)
const FEEDBACK = path.join(ROOT, 'review', 'feedback.jsonl')
fs.mkdirSync(path.dirname(FEEDBACK), { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.json': 'application/json', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg',
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ---------- 数据 ----------
const feedback = () =>
  fs.existsSync(FEEDBACK)
    ? fs.readFileSync(FEEDBACK, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []

function fragments() {
  const dir = path.join(ROOT, 'fragments')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, 'story.md')))
    .sort()
    .map((id) => {
      const rdir = path.join(ROOT, 'renders')
      const variants = fs.existsSync(rdir)
        ? fs.readdirSync(rdir).filter((f) => f.startsWith(id + '--') && /\.(mp4|webm)$/.test(f))
            .map((f) => ({ name: f.slice(id.length + 2).replace(/\.(mp4|webm)$/, ''), file: '/renders/' + f, mtime: fs.statSync(path.join(rdir, f)).mtimeMs }))
        : []
      const raws = fs.existsSync(path.join(dir, id, 'raw'))
        ? fs.readdirSync(path.join(dir, id, 'raw')).filter((f) => /\.(webm|mp4)$/.test(f)).map((f) => `/raw/${id}/${f}`)
        : []
      const metaPath = path.join(dir, id, 'meta.json')
      const meta = fs.existsSync(metaPath)
        ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        : { title: id, desc: '', act: '未归幕', order: 99, role: '未定', vo: [] }
      return { id, meta, variants, raws, story: fs.readFileSync(path.join(dir, id, 'story.md'), 'utf8') }
    })
}

const stories = () => {
  const dir = path.join(ROOT, 'stories')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort((a, b) => (a.startsWith('screenplay') ? -1 : 1)) : []
}
const music = () => {
  const dir = path.join(ROOT, 'music')
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort() : []
}
const voLines = () => {
  const p = path.join(ROOT, 'vo', 'lines.json')
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []
}

// ---------- 页面骨架 ----------
const CSS = `
  :root { --bg:#0d0f13; --panel:#161a21; --panel2:#1d222c; --line:#2a3140; --text:#e8ebf0; --dim:#8b93a3; --accent:#7aa2ff; --ok:#4ade80; --bad:#f87171; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:13px/1.55 -apple-system,"PingFang SC",sans-serif; padding:16px 20px; max-width:960px; margin:0 auto; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  h1 { font-size:17px; margin-bottom:3px; } h2 { font-size:13px; margin:14px 0 6px; color:var(--accent); }
  .sub { color:var(--dim); font-size:11.5px; margin-bottom:12px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:8px 12px; margin-bottom:8px; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 2px; border-bottom:1px dashed var(--line); }
  .row:last-child { border-bottom:none; }
  .tag { font-size:11px; padding:1px 8px; border-radius:99px; border:1px solid var(--line); color:var(--dim); white-space:nowrap; }
  .tag.ok { color:var(--ok); border-color:rgba(74,222,128,.4); } .tag.warn { color:#fbbf24; border-color:rgba(251,191,36,.4); }
  .tag.hi-review { color:#0d0f13; background:var(--accent); border-color:var(--accent); font-weight:700; }
  .tag.hi-work { color:#0d0f13; background:#fbbf24; border-color:#fbbf24; font-weight:700; }
  .detail { color:var(--dim); font-size:11px; }
  video { width:100%; border-radius:10px; background:#000; } audio { width:100%; }
  pre { white-space:pre-wrap; color:var(--dim); font:12.5px/1.6 inherit; background:var(--panel2); border-radius:10px; padding:14px; overflow-x:auto; }
  textarea { width:100%; min-height:64px; background:var(--panel2); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:9px; font:inherit; }
  button { border:none; border-radius:8px; padding:10px 18px; cursor:pointer; font-weight:600; margin-right:8px; margin-top:8px; }
  .b-ok { background:rgba(74,222,128,.15); color:var(--ok); border:1px solid rgba(74,222,128,.4); }
  .b-bad { background:rgba(248,113,113,.12); color:var(--bad); border:1px solid rgba(248,113,113,.4); }
  .hist { margin-top:12px; border-top:1px dashed var(--line); padding-top:8px; font-size:12.5px; color:var(--dim); }
  .v-ok { color:var(--ok); } .v-bad { color:var(--bad); }
  .crumb { font-size:12px; margin-bottom:14px; }
  .sent { color:var(--ok); font-size:12.5px; margin-top:6px; }
  input[type=radio] { accent-color:var(--accent); }
`
const TITLE = process.env.PROMO_TITLE ?? 'promo'
const page = (title, body, crumbs = true) => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(TITLE)} 评审台</title><style>${CSS}</style></head><body>
<input id="who" placeholder="署名" style="position:fixed;top:10px;right:12px;width:88px;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 9px;font:12px inherit;z-index:9">
${crumbs ? '<div class="crumb"><a href="/">← 成果索引</a></div>' : ''}
${body}
<script>
const whoEl = document.getElementById('who')
whoEl.value = localStorage.getItem('reviewer') || ''
whoEl.onchange = () => localStorage.setItem('reviewer', whoEl.value.trim())
async function send(payload, btn) {
  btn.disabled = true
  payload.who = whoEl.value.trim() || 'anon'
  await fetch('/api/feedback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
  btn.disabled = false
  const s = document.createElement('div'); s.className='sent'; s.textContent='已送达 Claude ✓（刷新可见历史）'
  btn.parentElement.appendChild(s); setTimeout(()=>s.remove(), 4000)
}
function val(id){ return document.getElementById(id).value.trim() }
function pickVal(name){ const r=document.querySelector('input[name="'+name+'"]:checked'); return r ? r.value : null }
</script></body></html>`

// 片段状态机：两个主态高亮——「待审批」（有片等人看）与「工作中」（在拍/在改）
// detail 区分：第几次打回、共几条批注、是否已按批注重渲（待复审第N轮）
function statusOf(f, fb) {
  const rejects = fb.filter((x) => x.verdict === 'reject').length
  const meta = { rejects, notes: fb.length }
  if (!f.variants.length) return { state: '工作中', hi: 'work', detail: f.raws.length ? '素材已到 · 渲染中' : '拍摄中', ...meta }
  const latestRender = Math.max(...f.variants.map((v) => v.mtime))
  if (!fb.length) return { state: '待审批', hi: 'review', detail: '首轮 · 未批', ...meta }
  const last = fb[fb.length - 1]
  const lastTs = Date.parse(last.ts)
  if (last.verdict === 'reject') {
    if (latestRender > lastTs) return { state: '待复审', hi: 'review', detail: `第 ${rejects + 1} 轮 · 已按批注重渲`, ...meta }
    return { state: '工作中', hi: 'work', detail: `第 ${rejects} 次被打回 · 整改中`, ...meta }
  }
  // 无「通过」语义：非打回批注后若出了新版本 → 待复审;否则维持待审批(有批注)
  if (latestRender > lastTs) return { state: '待复审', hi: 'review', detail: '批注后有新版本', ...meta }
  return { state: '待审批', hi: 'review', detail: '有批注 · 未打回', ...meta }
}
const stateTag = (s) =>
  `<span class="tag ${s.hi === 'review' ? 'hi-review' : s.hi === 'work' ? 'hi-work' : 'ok'}">${esc(s.state)}</span>`

const histHtml = (items) =>
  items.length
    ? `<div class="hist">${items.map((f) => `<div><span class="${f.verdict === 'approve' ? 'v-ok' : f.verdict === 'reject' ? 'v-bad' : ''}">[${esc(f.verdict || 'note')}]</span> ${f.who ? '<b>' + esc(f.who) + '</b> ' : ''}${f.pick ? '偏好:' + esc(f.pick) + ' ' : ''}${esc(f.comment || '')} <span style="opacity:.5">${esc((f.ts || '').slice(5, 16))}</span></div>`).join('')}</div>`
    : ''

// ---------- 各页 ----------
function indexPage() {
  const fb = feedback()
  const lastVerdict = (kind, id) => {
    const items = fb.filter((x) => x.kind === kind && (id === undefined || x.id === id))
    if (!items.length) return '<span class="tag">未批</span>'
    const v = items[items.length - 1].verdict
    return v === 'approve' ? '<span class="tag ok">已通过</span>' : v === 'reject' ? '<span class="tag warn">被打回</span>' : '<span class="tag">有批注</span>'
  }
  const frs = fragments().sort((a, b) => (a.meta.order ?? 99) - (b.meta.order ?? 99))
  const acts = ['序幕', '幕一', '幕二', '幕三', '幕四', '幕五', 'B-roll', '备选', '未归幕']
  const fragRow = (f) => {
    const fbF = fb.filter((x) => x.kind === 'fragment' && x.id === f.id)
    const s = statusOf(f, fbF)
    const role = f.meta.role === '主线' ? '' : ` <span class="tag">${esc(f.meta.role)}</span>`
    const counts = `${s.rejects ? `打回×${s.rejects} · ` : ''}${s.notes ? `批注×${s.notes}` : '无批注'}`
    return `<div class="row"><span style="min-width:0"><a href="/frag/${encodeURIComponent(f.id)}"><b>${esc(f.meta.title)}</b></a>${role} <span class="detail">${esc(f.meta.desc)}</span></span><span style="text-align:right;white-space:nowrap">${stateTag(s)}<br><span class="detail">${esc(s.detail)} · ${counts}</span></span></div>`
  }
  const allStatus = frs.map((f) => statusOf(f, fb.filter((x) => x.kind === 'fragment' && x.id === f.id)))
  const nReview = allStatus.filter((s) => s.hi === 'review').length
  const nWork = allStatus.filter((s) => s.hi === 'work').length
  return page('成果索引', `
  <h1>${esc(TITLE)} · 成果索引</h1>
  <div class="sub">按主剧本《一个 idea 的旅程》五幕陈列（<a href="/story/screenplay-v1">剧本全文</a>）　·　<span class="tag hi-review">待审批 ${nReview}</span> <span class="tag hi-work">工作中 ${nWork}</span></div>

  <h2>① 剧本 / 故事</h2>
  <div class="card">${stories().map((f) => `<div class="row"><a href="/story/${encodeURIComponent(f.replace('.md',''))}">${esc(f.replace('.md',''))}</a>${lastVerdict('story', f.replace('.md',''))}</div>`).join('') || '（空）'}</div>

  ${acts.map((act) => {
    const list = frs.filter((f) => f.meta.act === act)
    if (!list.length) return ''
    return `<h2>${esc(act)}</h2><div class="card">${list.map(fragRow).join('')}</div>`
  }).join('')}

  <h2>配音 · 旁白 v2 全稿</h2>
  <div class="card"><div class="row"><a href="/vo">12 句主 VO（yunwu MiniMax 主片音色）</a>${lastVerdict('vo')}</div></div>

  <h2>背景音乐候选</h2>
  <div class="card"><div class="row"><a href="/music">9 首 Mixkit 免费商用（暖调方向）</a>${lastVerdict('music')}</div></div>
  `, false)
}

function fragPage(id) {
  const f = fragments().find((x) => x.id === id)
  if (!f) return null
  const fb = feedback().filter((x) => x.kind === 'fragment' && x.id === id)
  const st = statusOf(f, fb)
  return page(f.meta.title, `
  <h1>${esc(f.meta.title)} <span style="color:var(--dim);font-size:12px">${esc(f.id)}</span> ${stateTag(st)}</h1>
  <div class="sub">${esc(st.detail)} · ${st.rejects ? `打回×${st.rejects} · ` : ''}批注×${st.notes} ｜ ${esc(f.meta.act)} · ${esc(f.meta.role)}${f.meta.vo?.length ? ' · 对应旁白 VO ' + f.meta.vo.join('/') : ''} · <a href="/story/screenplay-v1">主剧本</a> · URL：/frag/${esc(f.id)}</div>
  <div class="card" style="color:var(--dim)">${esc(f.meta.desc)}</div>
  ${f.variants.map((v) => `
    <div class="card">
      <div style="margin-bottom:8px"><input type="radio" name="pick" value="${esc(v.name)}"> 变式：<b>${esc(v.name)}</b></div>
      <video src="${v.file}" controls preload="metadata"></video>
    </div>`).join('') || '<div class="card">变式还没渲染。</div>'}
  ${f.raws.length ? `<div class="card" style="font-size:12.5px">原始素材：${f.raws.map((r) => `<a href="${r}">${esc(r.split('/').pop())}</a>`).join(' · ')}</div>` : ''}
  <div class="card"><details><summary style="cursor:pointer;color:var(--dim)">故事脚本</summary><pre>${esc(f.story)}</pre></details></div>
  <div class="card">
    <textarea id="c" placeholder="评注：节奏、文案、镜头、下一轮怎么改…"></textarea>
    <button class="b-ok" onclick="send({kind:'fragment',id:'${esc(f.id)}',verdict:'note',pick:pickVal('pick'),comment:val('c')},this)">提交批注</button>
    <button class="b-bad" onclick="send({kind:'fragment',id:'${esc(f.id)}',verdict:'reject',pick:pickVal('pick'),comment:val('c')},this)">❌ 打回</button>
    ${histHtml(fb)}
  </div>`)
}

function storyPage(name) {
  const p = path.join(ROOT, 'stories', name + '.md')
  if (!fs.existsSync(p)) return null
  const fb = feedback().filter((x) => x.kind === 'story' && (x.id === name || x.id === undefined))
  return page(name, `
  <h1>${esc(name)}</h1>
  <div class="sub">专属 URL：/story/${esc(name)}</div>
  <div class="card"><pre>${esc(fs.readFileSync(p, 'utf8'))}</pre></div>
  <div class="card">
    <textarea id="c" placeholder="批注：结构、口径、增删…"></textarea>
    <button class="b-ok" onclick="send({kind:'story',id:'${esc(name)}',verdict:'note',comment:val('c')},this)">提交批注</button>
    <button class="b-bad" onclick="send({kind:'story',id:'${esc(name)}',verdict:'reject',comment:val('c')},this)">❌ 打回</button>
    ${histHtml(fb)}
  </div>`)
}

function musicPage() {
  const fb = feedback().filter((x) => x.kind === 'music')
  return page('背景音乐', `
  <h1>背景音乐候选</h1>
  <div class="sub">专属 URL：/music · Mixkit 免费商用无署名</div>
  ${music().map((f) => `<div class="card"><div style="margin-bottom:6px"><input type="radio" name="pick" value="${esc(f.replace('.mp3',''))}"> ${esc(f.replace('.mp3','').replace(/--/g,' · ').replace(/-/g,' '))}</div><audio src="/music/${encodeURIComponent(f)}" controls preload="none"></audio></div>`).join('')}
  <div class="card">
    <textarea id="c" placeholder="听感批注：哪首对味/都不对/想要什么方向…"></textarea>
    <button class="b-ok" onclick="send({kind:'music',verdict:'note',pick:pickVal('pick'),comment:val('c')},this)">提交选择/批注</button>
    ${histHtml(fb)}
  </div>`)
}

function voPage() {
  const fb = feedback().filter((x) => x.kind === 'vo')
  const cmpDir = path.join(ROOT, 'vo', 'compare')
  const cmp = fs.existsSync(cmpDir) ? fs.readdirSync(cmpDir).filter((f) => f.endsWith('.mp3')).sort() : []
  const cmpByLine = {}
  for (const f of cmp) { const line = f.split('--')[0]; (cmpByLine[line] ??= []).push(f) }
  return page('旁白 VO v2', `
  <h1>旁白 v2 全稿（12 句）</h1>
  <div class="sub">专属 URL：/vo · 主音色 yunwu MiniMax speech-2.8-hd，speed 1.18</div>
  ${Object.keys(cmpByLine).length ? `<h2>音色对比（前三句 × grok / yunwu 各音色）</h2>${Object.entries(cmpByLine).map(([line, files]) => `<div class="card"><div style="margin-bottom:8px"><b>句 ${esc(line)}</b></div>${files.map((f) => `<div class="row"><span style="font-size:12px;color:var(--dim)">${esc(f.replace(line + '--', '').replace('.mp3', ''))}</span><audio src="/vo/compare/${encodeURIComponent(f)}" controls preload="none" style="width:340px"></audio></div>`).join('')}</div>`).join('')}<h2>主稿（当前默认音色）</h2>` : ''}
  ${voLines().map((l) => `<div class="card"><div style="margin-bottom:6px"><b>${esc(l.id)}</b> ${esc(l.text)}</div><audio src="/vo/${esc(l.id)}.mp3" controls preload="none"></audio></div>`).join('')}
  <div class="card">
    <textarea id="c" placeholder="批注：哪句要改词/换气口/语速音色…（引用句号如 03）"></textarea>
    <button class="b-ok" onclick="send({kind:'vo',verdict:'note',comment:val('c')},this)">提交批注</button>
    ${histHtml(fb)}
  </div>`)
}

// ---------- 静态与路由 ----------
function serveFile(req, res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('not found'); return }
  const stat = fs.statSync(file)
  const type = MIME[path.extname(file)] || 'application/octet-stream'
  const range = req.headers.range
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/)
    const start = m[1] ? Number(m[1]) : 0
    const end = m[2] ? Number(m[2]) : stat.size - 1
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type })
    fs.createReadStream(file, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' })
    fs.createReadStream(file).pipe(res)
  }
}

const html = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body) }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const p = decodeURIComponent(url.pathname)

  if (req.method === 'POST' && p === '/api/feedback') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        fs.appendFileSync(FEEDBACK, JSON.stringify({ ts: new Date().toISOString(), ...JSON.parse(body) }) + '\n')
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
      } catch (e) { res.writeHead(400).end(String(e)) }
    })
    return
  }
  if (p === '/' ) return html(res, indexPage())
  if (p === '/music') return html(res, musicPage())
  if (p === '/vo') return html(res, voPage())
  if (p.startsWith('/frag/')) {
    const b = fragPage(p.slice(6))
    return b ? html(res, b) : html(res, page('不存在', `<h1>这个片段不存在</h1><div class="sub">可能已按评审意见删除，或 id 拼写有误。回<a href="/">成果索引</a>看现存清单。</div>`))
  }
  if (p.startsWith('/story/')) { const b = storyPage(p.slice(7)); return b ? html(res, b) : res.writeHead(404).end('no such story') }
  if (p.startsWith('/renders/')) return serveFile(req, res, path.join(ROOT, 'renders', p.slice(9)))
  if (p.startsWith('/music/')) return serveFile(req, res, path.join(ROOT, 'music', p.slice(7)))
  if (p.startsWith('/vo/compare/')) return serveFile(req, res, path.join(ROOT, 'vo', 'compare', p.slice(12)))
  if (p.startsWith('/vo/')) return serveFile(req, res, path.join(ROOT, 'vo', p.slice(4)))
  if (p.startsWith('/raw/')) { const [, , id, ...rest] = p.split('/'); return serveFile(req, res, path.join(ROOT, 'fragments', id, 'raw', rest.join('/'))) }
  res.writeHead(404).end('not found')
})

server.listen(PORT, () => console.log(`review-server v2 (multi-page) on http://localhost:${PORT}`))
