import "./index.css";
import React from "react";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import { FRAGMENTS } from "./manifest";
import type { FragmentEntry } from "./lib/types";
import { keptSegments, mapSrcToOut, outDurationMs } from "./lib/edit";
import { ZoomFollow } from "./ZoomFollow";
import { NarrationOverlay } from "./NarrationOverlay";
import { C1Pain, C1_PAIN_DURATION } from "./synth/C1Pain";
import { C2LocalIdea, C2_LOCAL_IDEA_DURATION } from "./synth/C2LocalIdea";
import {
  FINAL_CUT_DURATION_IN_FRAMES,
  FINAL_CUT_FPS,
  FinalCut,
  finalCutCalcMeta,
} from "./final/FinalCut";

const FPS = 30;

const calcMeta: CalculateMetadataFunction<{ entry: FragmentEntry }> = async ({ props }) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(staticFile(props.entry.src), { getRetryDelay: () => null }),
  });
  const seconds = await input.computeDuration();
  const rawMs = seconds * 1000;
  const segs = keptSegments(rawMs, props.entry.cuts ?? []);
  // events/captions 全部重映射到剪切后的输出时间轴
  const entry: FragmentEntry = {
    ...props.entry,
    segments: segs,
    events: props.entry.events.map((e) => ({
      ...e,
      tMs: mapSrcToOut(e.tMs, segs),
      measuredVideoMs: e.measuredVideoMs !== undefined ? mapSrcToOut(e.measuredVideoMs, segs) : undefined,
    })),
    captions: props.entry.captions.map((c) => ({
      ...c,
      t0Ms: mapSrcToOut(c.t0Ms, segs),
      t1Ms: mapSrcToOut(c.t1Ms, segs),
    })),
  };
  return { durationInFrames: Math.max(1, Math.ceil((outDurationMs(segs) / 1000) * FPS)), props: { entry } };
};

const VARIANTS: Record<string, React.FC<{ entry: FragmentEntry }>> = {
  "zoom-follow": ZoomFollow,
  "narration-overlay": NarrationOverlay,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {FRAGMENTS.flatMap((entry) =>
        Object.entries(VARIANTS).map(([name, Comp]) => (
          <Composition
            key={`${entry.id}--${name}`}
            id={`${entry.id}--${name}`}
            component={Comp}
            fps={FPS}
            width={1920}
            height={1080}
            defaultProps={{ entry }}
            calculateMetadata={calcMeta}
          />
        )),
      )}
      {/* c1-pain 冲突幕:纯合成蒙太奇,无 raw 素材,时长写死 */}
      <Composition
        id="c1-pain--montage"
        component={C1Pain}
        fps={FPS}
        width={1920}
        height={1080}
        durationInFrames={C1_PAIN_DURATION}
      />
      {/* c2-local-idea 幕一场景A:本地 codex 终端磨 idea,纯合成,时长写死 */}
      <Composition
        id="c2-local-idea--montage"
        component={C2LocalIdea}
        fps={FPS}
        width={1920}
        height={1080}
        durationInFrames={C2_LOCAL_IDEA_DURATION}
      />
      {/* final-cut 终片总装:cutlist 驱动整片时间轴(素材源见 src/final/cutlist.ts) */}
      <Composition
        id="final-cut"
        component={FinalCut}
        fps={FINAL_CUT_FPS}
        width={1920}
        height={1080}
        durationInFrames={FINAL_CUT_DURATION_IN_FRAMES}
        defaultProps={{ resolved: null }}
        calculateMetadata={finalCutCalcMeta}
      />
    </>
  );
};
