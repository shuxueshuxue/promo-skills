import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { SegmentedVideo } from "./SegmentedVideo";
import { Stage, stageBaseScale } from "./Stage";
import { buildCameraKeys, cameraAt } from "./lib/camera";
import type { FragmentEntry } from "./lib/types";

// 变式一 zoom-follow：按事件时间轴做后期虚拟运镜（推近→保持→接力/回拉）。
// Devin 镜4/5/10 的「后期推拉」手法。
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
  return (
    <Stage video={entry.viewport} pose={pose}>
      <SegmentedVideo entry={entry} />
    </Stage>
  );
};
