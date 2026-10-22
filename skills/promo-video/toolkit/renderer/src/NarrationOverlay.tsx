import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { SegmentedVideo } from "./SegmentedVideo";
import { Stage } from "./Stage";
import type { Caption, FragmentEntry } from "./lib/types";

const CaptionBar: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inOut = interpolate(
    frame,
    [0, 0.35 * fps, durationInFrames - 0.35 * fps, durationInFrames],
    [0, 1, 1, 0],
    { easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        position: "absolute",
        bottom: 56,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: inOut,
        translate: `0 ${(1 - inOut) * 18}px`,
      }}
    >
      <div
        style={{
          background: "rgba(16,19,26,0.72)",
          backdropFilter: "blur(14px)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999,
          padding: "18px 40px",
          color: "#f2f4f8",
          fontSize: 34,
          fontWeight: 600,
          fontFamily: '-apple-system, "PingFang SC", sans-serif',
          letterSpacing: 0.5,
        }}
      >
        {text}
      </div>
    </div>
  );
};

// 变式二 narration-overlay：静置舞台 + 微推 KenBurns + 底部玻璃字幕条 + grok voice 旁白。
export const NarrationOverlay: React.FC<{ entry: FragmentEntry }> = ({ entry }) => {
  const frame = useCurrentFrame();
  const { fps, height, durationInFrames } = useVideoConfig();
  // 整段极缓微推,给静置画面一点生命(Devin 镜1「静帧微推」)
  const z = interpolate(frame, [0, durationInFrames], [1, 1.045], {
    easing: Easing.bezier(0.4, 0, 0.6, 1),
  });
  const s = (ms: number) => Math.round((ms / 1000) * fps);
  return (
    <AbsoluteFill>
      <Stage video={entry.viewport} pose={{ z, tx: 0, ty: (1 - z) * height * 0.04 }}>
        <SegmentedVideo entry={entry} />
      </Stage>
      {entry.captions.map((c: Caption, i) => (
        <Sequence key={i} from={s(c.t0Ms)} durationInFrames={Math.max(1, s(c.t1Ms) - s(c.t0Ms))} layout="none">
          <CaptionBar text={c.text} durationInFrames={Math.max(1, s(c.t1Ms) - s(c.t0Ms))} />
          {c.audio ? <Audio src={staticFile(c.audio)} /> : null}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
