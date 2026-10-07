import fs from 'node:fs'
import path from 'node:path'
import type { CDPSession, Page } from '@playwright/test'

// capture-lab 采集模块：ShotLoopRecorder —— CDP Page.captureScreenshot 逐帧节流循环。
// 实测裁定（capture-lab REPORT.md）：headless shell 下 Page.startScreencast 到帧率不可靠
// （真实 gugu 页面 / 视口仿真组合下会饿帧到 <1fps），captureScreenshot 主动拉帧则稳定
// 30fps@3200×2000（jpeg q100，~84KB/帧），且每帧都是 fromSurface 的完整合成结果，无损坏帧。
//
// 分辨率前置条件（调用方负责，start() 会验证并 fail loud）：
//   browser = await chromium.launch({ args: ['--no-sandbox', '--force-device-scale-factor=2'] })
//   ctx = await browser.newContext({ viewport: {1600×1000}, deviceScaleFactor: 2 })
// —— headless 下 screencast/screenshot 的物理面 = 窗口物理尺寸，只有 launch 级 flag 能把窗口
// 变成真 2x；playwright 的 per-context dsf 仿真只改 DPR 汇报，物理面仍 1x（PoC 1600×1000 的根因）。
//
// 输出格式与 cdp-recorder.ts 完全一致（frames/fNNNNNN.jpg + frames.json{endTsMs,frames[{file,tsMs}]}，
// tsMs = epoch 毫秒）→ promo-assemble.mjs 原样可用；事件照旧记 epoch 毫秒（events-epoch.json）。
//
// fail loud：分辨率不达预期 throw；循环内截图连续失败 throw（stop 时上抛）；0 帧 throw。

export type FrameMeta = { file: string; tsMs: number }

export type RecorderStats = {
  frameCount: number
  firstTsMs: number | null
  lastTsMs: number | null
  /** 实测平均帧率（帧数 / 首尾帧跨度） */
  avgFps: number
  /** 相邻帧最大间隔 ms（掉帧监测） */
  maxGapMs: number
  /** 因上一帧未完成而跳过的节拍数（>0 说明目标 fps 超出机器能力） */
  skippedTicks: number
}

export type RecorderOptions = {
  /** 目标帧率，默认 20（实测 3200×2000 jpeg100 上限 ~30） */
  fps?: number
  /** jpeg 质量，默认 100 */
  quality?: number
  /** 期望的帧物理宽度（分辨率验证，默认 viewport.width × 2）；传 0 跳过验证 */
  expectWidth?: number
}

// 只用可擦除的 TS（没有构造参数属性）：Node 自带的去类型就能跑，不必装 tsx。
export class ShotLoopRecorder {
  private page: Page
  private opts: RecorderOptions
  private cdp: CDPSession | null = null
  private outDir = ''
  private framesDir = ''
  private frames: FrameMeta[] = []
  private counter = 0
  private skippedTicks = 0
  private active = false
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight = false
  private loopError: Error | null = null

  constructor(page: Page, opts: RecorderOptions = {}) {
    this.page = page
    this.opts = opts
  }

  isActive(): boolean {
    return this.active
  }

  async start(outDir: string): Promise<void> {
    if (this.active) throw new Error('ShotLoopRecorder.start: already recording')
    this.outDir = outDir
    this.framesDir = path.join(outDir, 'frames')
    fs.mkdirSync(this.framesDir, { recursive: true })
    this.frames = []
    this.counter = 0
    this.skippedTicks = 0
    this.loopError = null
    this.cdp = await this.page.context().newCDPSession(this.page)

    // 分辨率验证：首帧必须是真 2x 物理像素（防呆：忘了 --force-device-scale-factor=2 会静默拍成 1x）
    const vp = this.page.viewportSize()
    const expectW = this.opts.expectWidth ?? (vp ? vp.width * 2 : 0)
    const first = await this.captureOne()
    if (expectW > 0) {
      const dims = jpegDims(first.buf)
      if (!dims || dims.w !== expectW) {
        throw new Error(
          `ShotLoopRecorder: 帧宽 ${dims?.w ?? '?'} ≠ 期望 ${expectW}。` +
          `浏览器须以 --force-device-scale-factor=2 启动（launch args），context 用 deviceScaleFactor:2。`,
        )
      }
    }
    this.writeFrame(first.buf, first.tsMs)

    const intervalMs = 1000 / (this.opts.fps ?? 20)
    this.active = true
    this.timer = setInterval(() => {
      if (!this.active) return
      if (this.inFlight) {
        this.skippedTicks += 1
        return
      }
      this.inFlight = true
      this.captureOne()
        .then(({ buf, tsMs }) => {
          if (this.active) this.writeFrame(buf, tsMs)
        })
        .catch((e: Error) => {
          // 录制中途单帧失败：记录并停止——宁可 loud 失败也不产出断轴素材
          this.loopError = e
          this.active = false
        })
        .finally(() => {
          this.inFlight = false
        })
    }, intervalMs)
  }

  private async captureOne(): Promise<{ buf: Buffer; tsMs: number }> {
    const t = Date.now()
    const { data } = await this.cdp!.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: this.opts.quality ?? 100,
      fromSurface: true,
    })
    // 时间戳取请求发出与返回的中点（合成发生在其间；实测往返 ~33ms，中点误差 <±17ms）
    return { buf: Buffer.from(data, 'base64'), tsMs: (t + Date.now()) / 2 }
  }

  private writeFrame(buf: Buffer, tsMs: number): void {
    const file = `f${String(this.counter).padStart(6, '0')}.jpg`
    this.counter += 1
    fs.writeFileSync(path.join(this.framesDir, file), buf)
    this.frames.push({ file, tsMs })
  }

  /** 停止并写 frames.json；返回统计。录制中途出过错在这里 loud 上抛。 */
  async stop(): Promise<RecorderStats> {
    if (!this.timer) throw new Error('ShotLoopRecorder.stop: not recording')
    clearInterval(this.timer)
    this.timer = null
    this.active = false
    // 等在途帧落账
    while (this.inFlight) await new Promise((r) => setTimeout(r, 20))
    const endTsMs = Date.now()
    await this.cdp?.detach().catch(() => {})
    this.cdp = null
    if (this.loopError) throw new Error(`ShotLoopRecorder: 录制中途截图失败 — ${this.loopError.message}`)
    if (this.frames.length === 0) throw new Error(`ShotLoopRecorder.stop: 0 frames captured in ${this.outDir}`)
    fs.writeFileSync(
      path.join(this.outDir, 'frames.json'),
      JSON.stringify({ endTsMs, frames: this.frames }, null, 1),
    )
    const first = this.frames[0].tsMs
    const last = this.frames[this.frames.length - 1].tsMs
    let maxGap = 0
    for (let i = 1; i < this.frames.length; i += 1) {
      maxGap = Math.max(maxGap, this.frames[i].tsMs - this.frames[i - 1].tsMs)
    }
    return {
      frameCount: this.frames.length,
      firstTsMs: first,
      lastTsMs: last,
      avgFps: this.frames.length > 1 ? (this.frames.length - 1) / ((last - first) / 1000) : 0,
      maxGapMs: Math.round(maxGap),
      skippedTicks: this.skippedTicks,
    }
  }
}

function jpegDims(buf: Buffer): { w: number; h: number } | null {
  for (let i = 2; i < buf.length - 9; i += 1) {
    if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
  }
  return null
}
