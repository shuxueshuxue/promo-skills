import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { SegmentedVideo } from "./SegmentedVideo";
import { Stage, stageBaseScale } from "./Stage";
import { buildCameraKeys, cameraAt } from "./lib/camera";
import type { Caption, FragmentEntry } from "./lib/types";

// 变式一 zoom-follow：按事件时间轴做后期虚拟运镜（推近→保持→接力/回拉）。
// Devin 镜4/5/10 的「后期推拉」手法。片段的旁白（captions.json 的 audio）照样出声，只是不画字幕条：
// 抽卡台第 4 轮两张卡写了旁白、成片却是静音（-91 dB）——这个变式原来不放音频。
export const ZoomFollow: React.FC<{ entry: FragmentEntry }> = ({ entry }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const base = stageBaseScale(entry.viewport, { w: width, h: height });
  const keys = useMemo(
    () =>
      buildCameraKeys(entry.events, entry.viewport, { w: width, h: height }, base, fps, durationInFrames),
    [entry, width, height, base, fps, durationInFrames],
  );
  const pose = cameraAt(frame, keys);
  const s = (ms: number) => Math.round((ms / 1000) * fps);
  return (
    <AbsoluteFill>
      <Stage video={entry.viewport} pose={pose}>
        <SegmentedVideo entry={entry} />
      </Stage>
      {entry.captions.map((c: Caption, i) =>
        c.audio ? (
          <Sequence key={i} from={s(c.t0Ms)} durationInFrames={Math.max(1, s(c.t1Ms) - s(c.t0Ms))} layout="none">
            <Audio src={staticFile(c.audio)} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
};
