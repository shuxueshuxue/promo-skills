import { Easing, interpolate } from "remotion";
import type { Box, CamEvent } from "./types";

export type Pose = { z: number; tx: number; ty: number };
type Key = { f: number } & Pose;

const WIDE: Pose = { z: 1, tx: 0, ty: 0 };

// @@@camera-math - 素材坐标中心 + 给定 z → world 变换目标位姿。
// card 以 baseScale 居中放在 comp 里；对中心 q 施加 scale(Z)（origin=comp中心）
// 后需 translate t = (C - q) * Z 使 q 落到 comp 中心。
// 导出给装配级恒定取景(cutlist video 段 frame 字段)复用。
export function pinnedPose(
  center: { x: number; y: number },
  z: number,
  video: { w: number; h: number },
  comp: { w: number; h: number },
  baseScale: number,
): Pose {
  const cardX = (comp.w - video.w * baseScale) / 2;
  const cardY = (comp.h - video.h * baseScale) / 2;
  const qx = cardX + center.x * baseScale;
  const qy = cardY + center.y * baseScale;
  // @@@pan-clamp - 几何精确钳制：卡片缩放后若大于画框,平移不得让卡片边缘进入画框
  // (可视窗保持在素材内部,不露舞台黑边);若小于画框,该轴不平移(平移必露边)。
  // 助理巡逻实拍发现旧启发式在贴边 box 下越界露纯黑条(m5@11.4s/m1@24.8s)。
  const cardW = video.w * baseScale * z;
  const cardH = video.h * baseScale * z;
  const maxTx = Math.max(0, (cardW - comp.w) / 2);
  const maxTy = Math.max(0, (cardH - comp.h) / 2);
  const clamp = (v: number, m: number) => Math.min(Math.max(v, -m), m);
  return { z, tx: clamp((comp.w / 2 - qx) * z, maxTx), ty: clamp((comp.h / 2 - qy) * z, maxTy) };
}

// 事件 box → 位姿:按 box 尺寸推 z(55% 覆盖,1.15–2.6 钳制),中心对准 box 中心。
function poseFor(
  box: Box,
  video: { w: number; h: number },
  comp: { w: number; h: number },
  baseScale: number,
): Pose {
  const zx = (comp.w * 0.55) / Math.max(1, box.width * baseScale);
  const zy = (comp.h * 0.55) / Math.max(1, box.height * baseScale);
  const z = Math.min(Math.max(Math.min(zx, zy), 1.15), 2.6);
  return pinnedPose({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, z, video, comp, baseScale);
}

// 事件时间轴 → 相机关键帧序列（推近-保持-回拉/接力）
export function buildCameraKeys(
  events: CamEvent[],
  video: { w: number; h: number },
  comp: { w: number; h: number },
  baseScale: number,
  fps: number,
  durationInFrames: number,
): Key[] {
  const s = (ms: number) => Math.round((ms / 1000) * fps);
  const at = (e: CamEvent) => e.measuredVideoMs ?? e.tMs; // 实测视频时间优先(VFR 漂移修正)
  const keys: Key[] = [{ f: 0, ...WIDE }];
  // 缩放白名单制（导演铁则）：任一事件显式标 zoom 时,只有 zoom:true 的事件触发推近;
  // 无任何 zoom 标记的旧素材维持「带 box 即推近」的兼容行为。
  const anyFlagged = events.some((e) => (e as { zoom?: boolean }).zoom !== undefined);
  const boxed = events
    .filter((e) => e.box && (!anyFlagged || (e as { zoom?: boolean }).zoom === true))
    .sort((a, b) => at(a) - at(b));

  for (let i = 0; i < boxed.length; i++) {
    const e = boxed[i];
    const pose = poseFor(e.box!, video, comp, baseScale);
    const fFocusStart = s(at(e)) - Math.round(0.25 * fps);
    const fFocus = s(at(e)) + Math.round(0.5 * fps);
    const fHoldEnd = fFocus + Math.round(1.3 * fps);
    const last = keys[keys.length - 1];
    // 接近段起点 = 保持上一位姿（若时间不够则跳过该起点,直接过渡）
    if (fFocusStart > last.f + 2) keys.push({ f: fFocusStart, z: last.z, tx: last.tx, ty: last.ty });
    if (fFocus > keys[keys.length - 1].f) keys.push({ f: fFocus, ...pose });
    const next = boxed[i + 1];
    const gapMs = next ? at(next) - at(e) : Infinity;
    if (fHoldEnd > keys[keys.length - 1].f && gapMs > 2200) {
      keys.push({ f: fHoldEnd, ...pose });
      // 距下个事件远（或收尾）→ 回拉全景
      if (gapMs > 4500) {
        const fWide = fHoldEnd + Math.round(0.8 * fps);
        if (!next || fWide < s(at(next)) - Math.round(0.4 * fps)) keys.push({ f: fWide, ...WIDE });
      }
    }
  }
  // 收尾回全景
  const last = keys[keys.length - 1];
  const fEnd = durationInFrames - Math.round(0.6 * fps);
  if (last.z !== 1 && fEnd > last.f + 2) keys.push({ f: fEnd, ...WIDE });
  // 严格递增防御
  return keys.filter((k, i) => i === 0 || k.f > keys[i - 1].f);
}

const ease = Easing.bezier(0.33, 0, 0.15, 1);

export function cameraAt(frame: number, keys: Key[]): Pose {
  if (keys.length === 1) return keys[0];
  const fs = keys.map((k) => k.f);
  const opt = { easing: ease, extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
  return {
    z: interpolate(frame, fs, keys.map((k) => k.z), opt),
    tx: interpolate(frame, fs, keys.map((k) => k.tx), opt),
    ty: interpolate(frame, fs, keys.map((k) => k.ty), opt),
  };
}
