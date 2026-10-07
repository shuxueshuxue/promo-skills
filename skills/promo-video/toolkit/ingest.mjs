#!/usr/bin/env node
// 把 fragments/<id>/ 的交付物（raw/take.webm + raw/events.json + captions.json + narration/*.mp3）
// 拷进 renderer/public/frag/<id>/ 并重新生成 renderer/src/manifest.ts。
// 幂等,可重复跑。缺 events.json 的片段跳过并告警(fail loud in output)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOLKIT = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(TOOLKIT, '..') // the film's folder: fragments/, renders/, review/
const RENDERER = path.join(TOOLKIT, 'renderer')
const FRAG = path.join(ROOT, 'fragments')
const PUB = path.join(RENDERER, 'public', 'frag')

// A box outside the recorded viewport makes the camera clamp to the frame edge and film empty page (2026-10-07 spike:
// a box at y=3158 in a 1000-high viewport, white for 0.97 s). Refused here, with the beat named, before anything renders.
function boxOutside(box, viewport) {
  return box.x < -1 || box.y < -1 || box.x + box.width > viewport.w + 1 || box.y + box.height > viewport.h + 1
}

const entries = []
for (const id of fs.readdirSync(FRAG).sort()) {
  const dir = path.join(FRAG, id)
  if (!fs.statSync(dir).isDirectory()) continue
  const eventsPath = path.join(dir, 'raw', 'events.json')
  if (!fs.existsSync(eventsPath)) {
    console.warn(`[skip] ${id}: 没有 raw/events.json`)
    continue
  }
  const ev = JSON.parse(fs.readFileSync(eventsPath, 'utf8'))
  const outside = ev.events.filter((e) => e.box && boxOutside(e.box, ev.viewport))
  if (outside.length) {
    throw new Error(`${id}: event box outside the ${ev.viewport.w}×${ev.viewport.h} viewport — ${outside.map((e) => `${e.label} ${JSON.stringify(e.box)}`).join('; ')}. Re-shoot: record the box once the page has stopped moving.`)
  }
  const videoSrc = path.join(dir, 'raw', ev.video)
  if (!fs.existsSync(videoSrc)) {
    console.warn(`[skip] ${id}: events.json 指向的视频不存在: ${ev.video}`)
    continue
  }
  const outDir = path.join(PUB, id)
  fs.mkdirSync(outDir, { recursive: true })
  fs.copyFileSync(videoSrc, path.join(outDir, ev.video))

  let captions = []
  const capPath = path.join(dir, 'captions.json')
  if (fs.existsSync(capPath)) {
    captions = JSON.parse(fs.readFileSync(capPath, 'utf8')).map((c) => {
      if (c.audio) {
        const audioSrc = path.join(dir, 'narration', c.audio)
        if (!fs.existsSync(audioSrc)) throw new Error(`${id}: caption 音频不存在: ${c.audio}`)
        fs.copyFileSync(audioSrc, path.join(outDir, c.audio))
        return { ...c, audio: `frag/${id}/${c.audio}` }
      }
      return c
    })
  }
  const cutsPath = path.join(dir, 'cuts.json')
  const cuts = fs.existsSync(cutsPath) ? JSON.parse(fs.readFileSync(cutsPath, 'utf8')) : undefined
  // 双/多视角片段：事件带 video 字段指向不同文件 → 按机位拆成多个 entry（--A/--B）
  const videoFiles = [...new Set(ev.events.map((e) => e.video).filter(Boolean))]
  if (videoFiles.length > 1) {
    videoFiles.sort((a, b) => (a === ev.video ? -1 : b === ev.video ? 1 : a.localeCompare(b)))
    videoFiles.forEach((vf, i) => {
      const srcPath = path.join(dir, 'raw', vf)
      if (!fs.existsSync(srcPath)) {
        console.warn(`[skip-cam] ${id}: 机位视频不存在 ${vf}`)
        return
      }
      fs.copyFileSync(srcPath, path.join(outDir, vf))
      const key = String.fromCharCode(65 + i) // A=主机位
      entries.push({
        id: `${id}--${key}`,
        title: `${id} 机位${key}`,
        src: `frag/${id}/${vf}`,
        viewport: ev.viewport,
        events: ev.events.filter((e) => e.video === vf).map((e) => {
          const { box, video, ...rest } = e
          return box ? { ...rest, box } : rest
        }),
        captions: captions.filter((c) => !c.video || c.video === vf).map(({ video, ...c }) => c),
      })
      console.log(`[ok] ${id} 机位${key}(${vf}): ${ev.events.filter((e) => e.video === vf).length} events`)
    })
    continue
  }
  entries.push({
    id,
    title: id,
    src: `frag/${id}/${ev.video}`,
    viewport: ev.viewport,
    // 清洗：box:null → 省略（workers 偶尔透传 Playwright 的 null）
    events: ev.events.map((e) => {
      const { box, ...rest } = e
      return box ? { ...rest, box } : rest
    }),
    captions,
    ...(cuts ? { cuts } : {}),
  })
  console.log(`[ok] ${id}: ${ev.events.length} events, ${captions.length} captions`)
}

const manifest = `// 由 tools/ingest.mjs 生成,勿手改。
import type { FragmentEntry } from "./lib/types";

export const FRAGMENTS: FragmentEntry[] = ${JSON.stringify(entries, null, 2)};
`
fs.writeFileSync(path.join(RENDERER, 'src', 'manifest.ts'), manifest)
console.log(`manifest.ts: ${entries.length} fragments`)
