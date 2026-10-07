// Playwright locator.boundingBox() 的原生形状,workers 直接透传
export type Box = { x: number; y: number; width: number; height: number };

// worker 录制时输出的事件时间轴（fragments/<id>/raw/events.json）
export type CamEvent = {
  tMs: number;
  label: string;
  box?: Box; // 视频坐标系（= 录制视口坐标）
  measuredVideoMs?: number; // webm 变帧率漂移时,worker 实测的视频内时间——镜头以它为准
  tBMs?: number; // 双视角副录(B)的对应时间
  note?: string;
  zoom?: boolean; // 缩放白名单(导演铁则):事件集中出现任何 zoom 标记时,仅 zoom:true 触发推近
  [extra: string]: unknown; // workers 的自定义注记字段(measuredBadgeLitMs 等)一律容忍
};

export type EventsFile = {
  video: string;
  viewport: { w: number; h: number };
  events: CamEvent[];
};

export type Caption = {
  t0Ms: number;
  t1Ms: number;
  text: string;
  audio?: string; // renderer/public 相对路径（staticFile）
  [extra: string]: unknown; // workers 自定义注记容忍
};

export type FragmentEntry = {
  id: string;
  title: string;
  src: string; // public/ 相对路径,如 raw/f1-add-contact.webm
  viewport: { w: number; h: number };
  events: CamEvent[];
  captions: Caption[];
  cuts?: { fromMs: number; toMs: number }[]; // 要掐掉的原始时间段（fragments/<id>/cuts.json）
  segments?: { from: number; to: number }[]; // calcMeta 填充:保留段（原始毫秒）
  rate?: number; // 播放倍速(final-cut 全片提速用;segments 仍是原始毫秒,events 已按 rate 重映射到输出轴)
};
