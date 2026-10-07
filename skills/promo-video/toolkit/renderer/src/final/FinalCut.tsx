import React from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  Sequence,
  interpolate,
  staticFile,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import { FRAGMENTS } from "../manifest";
import type { CamEvent, FragmentEntry } from "../lib/types";
import { mapSrcToOut, type Segment } from "../lib/edit";
import { pinnedPose } from "../lib/camera";
import { SegmentedVideo } from "../SegmentedVideo";
import { Stage, stageBaseScale } from "../Stage";
import { ZoomFollow } from "../ZoomFollow";
import { CaptionBar } from "../synth/shared";
import { C1Pain } from "../synth/C1Pain";
import { C2LocalIdea } from "../synth/C2LocalIdea";
import { CtaCard } from "./CtaCard";
import {
  BGM,
  CUTLIST,
  FADE_FRAMES,
  FPS,
  RATE,
  VO_TABLE,
  layoutCutlist,
  msf,
  segFrames,
  transAfter,
  type FrameSpec,
  type SynthSegSpec,
  type VideoSegSpec,
  type VoCue,
} from "./cutlist";

// FinalCut 总装机器:cutlist 驱动的整片时间轴装配。
// 每段 = 合成组件直嵌(synth) 或 素材卡片舞台+白名单相机(video,复用 ZoomFollow 全链路);
// 段间 TransitionSeries 叠化(c1→c2 硬切);VO/字幕按段铺,BGM 全程垫底+VO duck+CTA 渐出。
// 布局(段起点/总长/VO 时刻/duck 窗口)= cutlist.ts 的 layoutCutlist(),与 QA 脚本共用一份真相。

// c1 走单旁白轨模式(法典 21):关掉组件内 per-beat 双轨旁白,只铺 VO01 一条(male-qn-jingying),
// 字幕与音频逐字一致。fromFrame=8 与 cutlist 的 embeddedVos 登记一致。
const C1PainSingleTrack: React.FC = () => (
  <C1Pain
    narration={{
      src: VO_TABLE["01"].src,
      text: VO_TABLE["01"].text,
      fromFrame: 8,
      durFrames: msf(VO_TABLE["01"].durMs) + 6,
    }}
  />
);

const SYNTH_COMPS: Record<SynthSegSpec["comp"], React.FC> = {
  "c1-pain": C1PainSingleTrack,
  "c2-local-idea": C2LocalIdea,
  "cta-card": CtaCard,
};

const LAYOUT = layoutCutlist();

export const FINAL_CUT_FPS = FPS;
export const FINAL_CUT_DURATION_IN_FRAMES = LAYOUT.totalFrames;

const DUCK_WINDOWS = LAYOUT.duckWindows;
const CTA_START = LAYOUT.ctaStartFrame;

// —— calculateMetadata:解析素材源(events/viewport) + 剪点合法性校验(fail loud) ——

type ResolvedSeg =
  | (SynthSegSpec & { durationInFrames: number })
  | (VideoSegSpec & { durationInFrames: number; entry: FragmentEntry });

export type FinalCutProps = { resolved: ResolvedSeg[] | null };

const eventAt = (e: CamEvent) => e.measuredVideoMs ?? e.tMs;

async function probeDurationMs(src: string): Promise<number> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(staticFile(src), { getRetryDelay: () => null }),
  });
  return (await input.computeDuration()) * 1000;
}

async function resolveVideoSeg(seg: VideoSegSpec): Promise<ResolvedSeg> {
  // 1) events/viewport 来源
  let viewport: { w: number; h: number };
  let events: CamEvent[];
  if (seg.manifestId) {
    const frag = FRAGMENTS.find((f) => f.id === seg.manifestId);
    if (!frag) throw new Error(`final-cut[${seg.id}]: manifest 里没有 fragment "${seg.manifestId}"`);
    viewport = frag.viewport;
    events = frag.events;
  } else if (seg.eventsFile) {
    const res = await fetch(staticFile(seg.eventsFile));
    if (!res.ok) throw new Error(`final-cut[${seg.id}]: 读不到 events 文件 ${seg.eventsFile} (${res.status})`);
    const json = (await res.json()) as { viewport?: { w: number; h: number }; events?: CamEvent[] };
    if (!json.viewport || !json.events) {
      throw new Error(`final-cut[${seg.id}]: ${seg.eventsFile} 缺 viewport/events 字段`);
    }
    viewport = json.viewport;
    events = json.events;
  } else {
    throw new Error(`final-cut[${seg.id}]: video 段必须给 manifestId(占位) 或 eventsFile(acts)`);
  }

  // 2) keepMs 合法性:升序、不重叠、落在素材时长内(超界 = 剪点写错,直接报错停)
  if (seg.keepMs.length === 0) throw new Error(`final-cut[${seg.id}]: keepMs 为空`);
  const rawMs = await probeDurationMs(seg.src);
  let prev = -1;
  for (const k of seg.keepMs) {
    if (!(k.fromMs < k.toMs)) throw new Error(`final-cut[${seg.id}]: keepMs 段 ${k.fromMs}→${k.toMs} 非法`);
    if (k.fromMs < prev) throw new Error(`final-cut[${seg.id}]: keepMs 必须升序且不重叠`);
    if (k.toMs > rawMs + 80) {
      throw new Error(
        `final-cut[${seg.id}]: keepMs 超出素材时长 ${seg.src} (${Math.round(rawMs)}ms < ${k.toMs}ms)`,
      );
    }
    prev = k.toMs;
  }

  // 3) events 重映射到段输出时间轴(丢掉落在保留段之外的事件,避免吸附到剪切口乱推);
  //    全片提速:输出轴 = 剪后时间 / RATE(镜头锚点跟画面同倍速走)
  const segments: Segment[] = seg.keepMs.map((k) => ({ from: k.fromMs, to: k.toMs }));
  const inside = (ms: number) => segments.some((s) => ms >= s.from && ms <= s.to);
  const remapped = events
    .filter((e) => inside(eventAt(e)))
    .map((e) => ({
      ...e,
      tMs: mapSrcToOut(e.tMs, segments) / RATE,
      measuredVideoMs:
        e.measuredVideoMs !== undefined ? mapSrcToOut(e.measuredVideoMs, segments) / RATE : undefined,
    }));

  const entry: FragmentEntry = {
    id: seg.id,
    title: seg.id,
    src: seg.src,
    viewport,
    events: remapped,
    captions: [], // 终片字幕 = VO v2,不用 fragment 旧字幕
    segments,
    rate: RATE, // 全片提速:SegmentedVideo 按源帧 trim + playbackRate 推进
  };
  return { ...seg, durationInFrames: segFrames(seg), entry };
}

export const finalCutCalcMeta: CalculateMetadataFunction<FinalCutProps> = async () => {
  const resolved = await Promise.all(
    CUTLIST.map((seg) =>
      seg.kind === "synth"
        ? Promise.resolve<ResolvedSeg>({ ...seg, durationInFrames: seg.durationFrames })
        : resolveVideoSeg(seg),
    ),
  );
  return { durationInFrames: FINAL_CUT_DURATION_IN_FRAMES, props: { resolved } };
};

// —— 段内容 ——

const VoLayer: React.FC<{ vos?: VoCue[] }> = ({ vos }) => (
  <>
    {(vos ?? []).map((c) => {
      const line = VO_TABLE[c.vo];
      const dur = Math.max(1, msf(line.durMs)) + 6; // 字幕比语音多留 6 帧收尾
      return (
        <Sequence key={c.vo} from={msf(c.atMs)} durationInFrames={dur} layout="none">
          <CaptionBar text={line.text} durationInFrames={dur} />
          <Audio src={staticFile(line.src)} />
        </Sequence>
      );
    })}
  </>
);

// 装配级恒定取景(cutlist video 段 frame 字段):整段固定位姿,不走事件运镜。
// 位姿数学复用 camera.ts pinnedPose(pan-clamp 同款,不露舞台底)。
const PinnedFrame: React.FC<{ entry: FragmentEntry; frame: FrameSpec }> = ({ entry, frame }) => {
  const { width, height } = useVideoConfig();
  const comp = { w: width, h: height };
  const base = stageBaseScale(entry.viewport, comp);
  const pose = pinnedPose({ x: frame.cx, y: frame.cy }, frame.z, entry.viewport, comp, base);
  return (
    <Stage video={entry.viewport} pose={pose}>
      <SegmentedVideo entry={entry} />
    </Stage>
  );
};

const SegContent: React.FC<{ seg: ResolvedSeg }> = ({ seg }) => {
  if (seg.kind === "synth") {
    const Comp = SYNTH_COMPS[seg.comp];
    const trim = seg.trimStartFrames ?? 0;
    return (
      <AbsoluteFill>
        {trim > 0 ? (
          <Sequence from={-trim} layout="none">
            <Comp />
          </Sequence>
        ) : (
          <Comp />
        )}
        <VoLayer vos={seg.vos} />
      </AbsoluteFill>
    );
  }
  // video 段:Stage 卡片舞台 + cuts 分段播放;相机 = 恒定取景(frame) 或 白名单事件运镜(ZoomFollow)
  return (
    <AbsoluteFill>
      {seg.frame ? <PinnedFrame entry={seg.entry} frame={seg.frame} /> : <ZoomFollow entry={seg.entry} />}
      <VoLayer vos={seg.vos} />
    </AbsoluteFill>
  );
};

// —— BGM:垫底 + VO duck + CTA 渐出(素材 96.6s < 片长 → loop 续上) ——

const clampOpt = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

const bgmVolume = (f: number): number => {
  const r = BGM.duckRampFrames;
  let duck = 1;
  for (const [a, b] of DUCK_WINDOWS) {
    if (f <= a - r || f >= b + r) continue;
    duck = Math.min(
      duck,
      interpolate(f, [a - r, a, b, b + r], [1, BGM.duckRatio, BGM.duckRatio, 1], clampOpt),
    );
  }
  const fadeIn = interpolate(f, [0, 20], [0.5, 1], clampOpt);
  const fadeOut = interpolate(f, [CTA_START, FINAL_CUT_DURATION_IN_FRAMES - 6], [1, 0], clampOpt);
  return BGM.baseVolume * duck * fadeIn * fadeOut;
};

// —— 总装 ——

export const FinalCut: React.FC<FinalCutProps> = ({ resolved }) => {
  if (!resolved) {
    throw new Error("final-cut: props 未经 calculateMetadata 解析(不要绕过 Root 的注册直接渲染)");
  }
  const items: React.ReactNode[] = [];
  resolved.forEach((seg, i) => {
    items.push(
      <TransitionSeries.Sequence key={seg.id} durationInFrames={seg.durationInFrames}>
        <SegContent seg={seg} />
      </TransitionSeries.Sequence>,
    );
    if (i < resolved.length - 1 && transAfter(seg) === "fade") {
      items.push(
        <TransitionSeries.Transition
          key={`${seg.id}--fade`}
          presentation={fade()}
          timing={linearTiming({ durationInFrames: FADE_FRAMES })}
        />,
      );
    }
  });
  return (
    <AbsoluteFill style={{ background: "#0a0b0e" }}>
      <TransitionSeries>{items}</TransitionSeries>
      <Audio
        src={staticFile(BGM.src)}
        trimBefore={Math.round(BGM.skipSeconds * FPS)}
        loop
        loopVolumeCurveBehavior="extend"
        volume={bgmVolume}
      />
    </AbsoluteFill>
  );
};
