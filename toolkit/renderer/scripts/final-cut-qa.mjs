#!/usr/bin/env node
// final-cut 装配 QA(法典 20;导演验收工序,换源后必须重跑):
//   ① 空白屏扫描:对每个 video 段,在卡片内部区域跑 blackdetect(黑)+ negate blackdetect(白),
//      任何 ≥0.4s 的整面黑/白命中 = 装配未完成,退出码 1。
//   ② VO 对齐抽帧:每句 VO(含合成段内嵌)起点+中点各抽一帧到 renders/final-cut-qa/,
//      逐帧人工核对「画面主语 = 当句旁白主语」。
// 用法: node scripts/final-cut-qa.mjs [片路径]   (默认 ../renders/final-cut.mp4)
// 布局真相直接 import src/final/cutlist.ts(node --experimental-strip-types,自动 re-exec)。

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// —— 自动带上 strip-types 重启(让本脚本能直接 import cutlist.ts) ——
if (!process.execArgv.some((a) => a.includes("strip-types"))) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
}

const here = dirname(fileURLToPath(import.meta.url));
const rendererDir = resolve(here, "..");
const film = resolve(process.argv[2] ?? join(rendererDir, "../renders/final-cut.mp4"));
const outDir = join(rendererDir, "../renders/final-cut-qa");

const { CUTLIST, FPS, layoutCutlist, segFrames } = await import("../src/final/cutlist.ts");
const { FRAGMENTS } = await import("../src/manifest.ts");

if (!existsSync(film)) {
  console.error(`✗ 找不到成片: ${film}(先渲染 final-cut)`);
  process.exit(1);
}

const layout = layoutCutlist();
const COMP = { w: 1920, h: 1080 };
const sec = (f) => f / FPS;
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;

// ffprobe 实测时长 vs 布局时长(装配一致性)
const measured = parseFloat(
  execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", film]).toString(),
);
console.log(`成片: ${film}`);
console.log(`时长: 实测 ${measured.toFixed(2)}s / 布局 ${sec(layout.totalFrames).toFixed(2)}s (${layout.totalFrames}f)`);
if (Math.abs(measured - sec(layout.totalFrames)) > 0.5) {
  console.error("✗ 实测时长与 cutlist 布局不符——成片不是当前 cutlist 渲的,先重渲再 QA");
  process.exit(1);
}
// 导演终版指令②:全片 1.25× 提速,目标 ≈96s(VO 音频/合成段不变速 → 实际下限 ~100s)
if (sec(layout.totalFrames) < 90 || sec(layout.totalFrames) > 110) {
  console.warn(`⚠ 总长 ${sec(layout.totalFrames).toFixed(1)}s 偏离 1.25× 提速后的目标带 90–110s`);
}

// —— ① 空白屏扫描(逐 video 段,卡片内部裁剪;合成段是作者化画面不扫) ——
// 卡片几何 = Stage.tsx 同式:baseScale=min(84%h/vh, 84%w/vw),居中;内缩 8% 保证
// 裁剪区永远在卡片内部(zoom 只会放大卡片,不会缩出)。
function cardInterior(viewport) {
  const bs = Math.min((COMP.h * 0.84) / viewport.h, (COMP.w * 0.84) / viewport.w);
  const w = viewport.w * bs;
  const h = viewport.h * bs;
  const inset = 0.08;
  return {
    w: Math.round(w * (1 - 2 * inset)),
    h: Math.round(h * (1 - 2 * inset)),
    x: Math.round((COMP.w - w) / 2 + w * inset),
    y: Math.round((COMP.h - h) / 2 + h * inset),
  };
}

function viewportOf(seg) {
  if (seg.manifestId) {
    const frag = FRAGMENTS.find((f) => f.id === seg.manifestId);
    if (!frag) throw new Error(`[${seg.id}] manifest 里没有 "${seg.manifestId}"`);
    return frag.viewport;
  }
  const json = JSON.parse(readFileSync(join(rendererDir, "public", seg.eventsFile), "utf8"));
  if (!json.viewport) throw new Error(`[${seg.id}] ${seg.eventsFile} 缺 viewport`);
  return json.viewport;
}

function detect(from, dur, vf) {
  const out = spawnSync(
    "ffmpeg",
    ["-v", "info", "-ss", from.toFixed(3), "-t", dur.toFixed(3), "-i", film, "-vf", vf, "-an", "-f", "null", "-"],
    { encoding: "utf8" },
  ).stderr;
  return [...out.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({
    from: from + parseFloat(m[1]),
    to: from + parseFloat(m[2]),
  }));
}

console.log("\n== ① 空白屏扫描(video 段卡片内部,黑+白,d≥0.4s) ==");
let blanks = 0;
CUTLIST.forEach((seg, i) => {
  if (seg.kind !== "video") return;
  const c = cardInterior(viewportOf(seg));
  // 掐掉段两端各 0.45s 的转场混合区(双画面叠化不构成单源空白)
  const pad = 0.45;
  const from = sec(layout.starts[i]) + pad;
  const dur = sec(segFrames(seg)) - 2 * pad;
  if (dur <= 0) return;
  const crop = `crop=${c.w}:${c.h}:${c.x}:${c.y}`;
  // 白项校准(亮色主题素材,标准不变=整面无内容才打回):gugu 亮色 UI 的浅灰面(侧栏/气泡底
  // #f4-#f7)在 pix_th=0.10 下全被算成「白」,有内容的稀疏页会假阳性。实测分离点:
  // pix_th=0.07(排除浅灰面) + pic_th=0.99——纯白 loading 页(≈0.995+)命中,
  // 带侧栏/气泡/文字的真实页面(≤0.99)通过。黑项维持 0.10(暗色整面才命中)。
  const hits = [
    ...detect(from, dur, `${crop},blackdetect=d=0.4:pix_th=0.10`).map((h) => ({ ...h, kind: "黑" })),
    ...detect(from, dur, `${crop},negate,blackdetect=d=0.4:pix_th=0.07:pic_th=0.99`).map((h) => ({ ...h, kind: "白" })),
  ];
  for (const h of hits) {
    blanks++;
    console.error(`  ✗ [${seg.id}] ${h.kind}屏 ${fmt(h.from)} → ${fmt(h.to)}(全片绝对时刻)`);
  }
});
console.log(blanks === 0 ? "  ✓ 零命中" : `  共 ${blanks} 处空白——修 cutlist 剪点后重渲再跑`);

// —— ② VO 对齐抽帧(起点 + 中点) ——
console.log("\n== ② VO 对齐抽帧(逐帧人工核对:画面主语 = 当句旁白主语) ==");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const cue of layout.cues) {
  const start = sec(cue.startFrame) + 0.1; // 起点后 0.1s,避开字幕淡入首帧
  const mid = sec(cue.startFrame + Math.round(cue.durFrames / 2));
  for (const [tag, t] of [["start", start], ["mid", mid]]) {
    const png = join(outDir, `vo-${cue.vo}-${tag}.png`);
    execFileSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(3), "-i", film, "-frames:v", "1", "-y", png]);
  }
  console.log(
    `  VO${cue.vo} @${fmt(sec(cue.startFrame))} [${cue.segId}${cue.embedded ? "·内嵌" : ""}] ${cue.text.slice(0, 22)}…`,
  );
}
console.log(`\n抽帧目录: ${outDir}(vo-<句>-start/mid.png)`);

process.exit(blanks === 0 ? 0 : 1);
