import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { Pose } from "./lib/camera";

// 共用舞台：品牌渐变底 + 圆角悬浮窗卡片（Devin 式「深灰底悬浮圆角浏览器窗」）。
// camera 位姿作用在 world 层——运镜全后期。
export const Stage: React.FC<{
  video: { w: number; h: number };
  pose: Pose;
  children: React.ReactNode; // <Video> 本体,原始像素尺寸渲染
}> = ({ video, pose, children }) => {
  const { width, height } = useVideoConfig();
  const baseScale = Math.min((height * 0.84) / video.h, (width * 0.84) / video.w);
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 140% at 20% 0%, #1c2230 0%, #0d0f13 55%, #0a0b0e 100%)",
      }}
    >
      {/* 氛围光斑 */}
      <div
        style={{
          position: "absolute",
          width: width * 0.5,
          height: width * 0.5,
          left: -width * 0.12,
          top: -width * 0.18,
          background: "radial-gradient(circle, rgba(122,162,255,0.14) 0%, transparent 65%)",
          filter: "blur(20px)",
        }}
      />
      <AbsoluteFill
        style={{
          translate: `${pose.tx}px ${pose.ty}px`,
          scale: String(pose.z),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: (width - video.w * baseScale) / 2,
            top: (height - video.h * baseScale) / 2,
            width: video.w * baseScale,
            height: video.h * baseScale,
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 40px 90px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              width: video.w,
              height: video.h,
              scale: String(baseScale),
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const stageBaseScale = (
  video: { w: number; h: number },
  comp: { w: number; h: number },
): number => Math.min((comp.h * 0.84) / video.h, (comp.w * 0.84) / video.w);
