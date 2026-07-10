// 片内剪切：fragments/<id>/cuts.json 声明要掐掉的原始时间段,
// calcMeta 里把 events/captions 重映射到输出时间轴,组件用分段 <Video> 播放保留段。
export type Cut = { fromMs: number; toMs: number };
export type Segment = { from: number; to: number }; // 原始视频毫秒,保留段

export function keptSegments(durationMs: number, cuts: Cut[] = []): Segment[] {
  const sorted = [...cuts].sort((a, b) => a.fromMs - b.fromMs);
  const segs: Segment[] = [];
  let cur = 0;
  for (const c of sorted) {
    if (c.fromMs > cur) segs.push({ from: cur, to: Math.min(c.fromMs, durationMs) });
    cur = Math.max(cur, c.toMs);
  }
  if (cur < durationMs) segs.push({ from: cur, to: durationMs });
  return segs.filter((s) => s.to > s.from);
}

// 原始时间 → 输出时间（落在被剪段内的时间点吸附到剪切口）
export function mapSrcToOut(ms: number, segs: Segment[]): number {
  let out = 0;
  for (const s of segs) {
    if (ms < s.from) return out;
    if (ms <= s.to) return out + (ms - s.from);
    out += s.to - s.from;
  }
  return out;
}

export const outDurationMs = (segs: Segment[]): number => segs.reduce((a, s) => a + (s.to - s.from), 0);
