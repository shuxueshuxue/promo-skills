#!/usr/bin/env node
// promo-assemble.mjs — CDP 逐帧素材 → 高码率 h264 中间片 + 事件时间轴归一（scratch，不入 git）
//
// 输入目录结构（CdpRecorder 产出）：
//   <actDir>/frames/fNNNNNN.jpg
//   <actDir>/frames.json            { endTsMs, frames: [{ file, tsMs }] }
//   <actDir>/events-epoch.json      （可选）{ events: [{ tsMs(epoch), label, box?, zoom? }], ... }
// 输出：
//   <actDir>/<name>.mp4             concat demuxer 按真实帧间隔组装 → fps=30 CFR、libx264 crf、yuv420p
//   <actDir>/<name>.events.json     tMs = epoch − 首帧 epoch（事件直接对齐帧时间戳）
//
// 用法：node promo-assemble.mjs <actDir> --name act1a [--crf 13] [--fps 30]
// fail loud：ffmpeg 非零退出直接 throw；缺 frames.json throw。

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const FFMPEG = process.env.PROMO_FFMPEG
  ?? path.join(os.homedir(), 'promo-tools/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg')

const args = process.argv.slice(2)
const actDir = args.find((a) => !a.startsWith('--'))
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d }
if (!actDir) throw new Error('usage: node promo-assemble.mjs <actDir> --name actN [--crf 13] [--fps 30]')
const name = get('name', path.basename(actDir))
const crf = Number(get('crf', '13'))
const fps = Number(get('fps', '30'))

const framesJsonPath = path.join(actDir, 'frames.json')
if (!existsSync(framesJsonPath)) throw new Error(`missing ${framesJsonPath}`)
const { endTsMs, frames } = JSON.parse(readFileSync(framesJsonPath, 'utf8'))
if (!frames?.length) throw new Error('frames.json has no frames')

const t0 = frames[0].tsMs

// ffconcat：每帧持续到下一帧；尾帧持续到 endTsMs（至少 1 帧时长）
let list = 'ffconcat version 1.0\n'
for (let i = 0; i < frames.length; i += 1) {
  const durMs = i + 1 < frames.length
    ? frames[i + 1].tsMs - frames[i].tsMs
    : Math.max((endTsMs ?? frames[i].tsMs) - frames[i].tsMs, 1000 / fps)
  if (durMs < 0) throw new Error(`non-monotonic frame timestamps at #${i}`)
  list += `file 'frames/${frames[i].file}'\nduration ${(durMs / 1000).toFixed(6)}\n`
}
// concat demuxer 需要末行再列一次尾帧
list += `file 'frames/${frames[frames.length - 1].file}'\n`
const listPath = path.join(actDir, 'list.ffconcat')
writeFileSync(listPath, list)

const outPath = path.join(actDir, `${name}.mp4`)
const ff = spawnSync(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'concat', '-safe', '0', '-i', listPath,
  '-vf', `fps=${fps},format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf),
  '-movflags', '+faststart',
  outPath,
], { stdio: ['ignore', 'inherit', 'inherit'] })
if (ff.status !== 0) throw new Error(`ffmpeg exited ${ff.status}`)

const durS = ((endTsMs ?? frames[frames.length - 1].tsMs) - t0) / 1000
const sizeB = statSync(outPath).size
const mbps = (sizeB * 8 / durS / 1e6).toFixed(2)

// 事件时间轴归一：epoch → 相对首帧
const evPath = path.join(actDir, 'events-epoch.json')
if (existsSync(evPath)) {
  const raw = JSON.parse(readFileSync(evPath, 'utf8'))
  const events = (raw.events ?? []).map((e) => {
    const { tsMs, ...rest } = e
    return { tMs: Math.round(tsMs - t0), ...rest }
  })
  writeFileSync(
    path.join(actDir, `${name}.events.json`),
    JSON.stringify({ video: `${name}.mp4`, ...raw.meta, durationMs: Math.round(durS * 1000), events }, null, 2),
  )
}

console.log(`[assemble] ${name}.mp4  frames=${frames.length}  dur=${durS.toFixed(1)}s  size=${(sizeB / 1e6).toFixed(1)}MB  bitrate=${mbps}Mbps`)
if (Number(mbps) < 8) console.error(`[assemble] WARNING: bitrate ${mbps}Mbps < 8Mbps 硬性要求（静态画面多时属正常——CRF 恒质量，清晰度以抽帧为准）`)
