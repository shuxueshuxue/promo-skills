import React from "react";
import { Series, staticFile, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import type { FragmentEntry } from "./lib/types";

// 分段播放保留段（cuts 掐掉的段被跳过）;无 cuts 时就是整段播放。
// entry.rate（final-cut 全片提速）:trimBefore/trimAfter 是源时间帧(不随倍速),
// 段时长按 rate 折算,<Video playbackRate> 负责推进(源时刻 = trimBefore + 输出帧×rate)。
export const SegmentedVideo: React.FC<{ entry: FragmentEntry }> = ({ entry }) => {
  const { fps } = useVideoConfig();
  const rate = entry.rate ?? 1;
  const segs = entry.segments ?? [{ from: 0, to: Number.MAX_SAFE_INTEGER }];
  const style = { width: entry.viewport.w, height: entry.viewport.h };
  if (segs.length === 1 && segs[0].from === 0 && segs[0].to === Number.MAX_SAFE_INTEGER) {
    return <Video src={staticFile(entry.src)} playbackRate={rate} style={style} muted />;
  }
  const f = (ms: number) => Math.round((ms / 1000) * fps);
  return (
    <Series>
      {segs.map((s, i) => (
        <Series.Sequence key={i} durationInFrames={Math.max(1, f((s.to - s.from) / rate))}>
          <Video
            src={staticFile(entry.src)}
            trimBefore={f(s.from)}
            trimAfter={f(s.to)}
            playbackRate={rate}
            style={style}
            muted
          />
        </Series.Sequence>
      ))}
    </Series>
  );
};
