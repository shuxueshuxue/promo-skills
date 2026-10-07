import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

// c1-pain 合成场景共用件。视觉基调承接 Stage.tsx 的暗色渐变宇宙;
// 字幕条样式复用 NarrationOverlay 的玻璃胶囊(未导出,此处同参重建)。

export const FONT = '-apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';
export const RED = "#ff4d4f";
export const RED_DEEP = "#e5484d";
export const ORANGE = "#ff7a45";
export const INK = "#242938";
export const INK_SOFT = "#4a5164";
export const WIN_SHADOW = "0 30px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)";

// 同 Stage.tsx 的品牌渐变底 + 氛围光斑
export const PainStage: React.FC = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 140% at 20% 0%, #1c2230 0%, #0d0f13 55%, #0a0b0e 100%)",
      }}
    >
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
    </AbsoluteFill>
  );
};

// 同 NarrationOverlay.CaptionBar 的底部玻璃字幕条
export const CaptionBar: React.FC<{ text: string; durationInFrames: number }> = ({
  text,
  durationInFrames,
}) => {
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
          fontFamily: FONT,
          letterSpacing: 0.5,
        }}
      >
        {text}
      </div>
    </div>
  );
};

// 中性浅色 mock 窗体:红绿灯 + 标题栏文字标识(❌ 真 logo)
export const MockWindow: React.FC<{
  title: string;
  width: number;
  height: number;
  children: React.ReactNode;
  bodyStyle?: React.CSSProperties;
}> = ({ title, width, height, children, bodyStyle }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 14,
      overflow: "hidden",
      background: "#fbfcfe",
      boxShadow: WIN_SHADOW,
      fontFamily: FONT,
      display: "flex",
      flexDirection: "column",
    }}
  >
    <div
      style={{
        height: 46,
        flex: "0 0 46px",
        background: "linear-gradient(180deg, #eef0f4 0%, #e6e9ef 100%)",
        borderBottom: "1px solid #d8dce4",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 8,
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
      ))}
      <div
        style={{
          flex: 1,
          textAlign: "center",
          fontSize: 20,
          fontWeight: 600,
          color: "#5a6070",
          letterSpacing: 0.4,
          // 抵消左侧红绿灯宽度,让标题真居中
          marginRight: 55,
        }}
      >
        {title}
      </div>
    </div>
    <div style={{ flex: 1, position: "relative", ...bodyStyle }}>{children}</div>
  </div>
);
