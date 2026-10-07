import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Audio } from "@remotion/media";
import { FONT } from "../synth/shared";

// CTA 收尾卡(约 6s):压暗 → 咕咕标识 → 主句(= VO12,卡面即字幕) → 副行小字。
// 导演法典:收尾禁 zoom——只做透明度/轻位移渐显,全程全景静置。

export const CTA_CARD_DURATION = 180;

const VO12_AT = 12; // 主句与 VO12 同起(旁白不许晚到)

const riseIn = (frame: number, at: number, dur = 18) =>
  interpolate(frame, [at, at + dur], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const CtaCard: React.FC = () => {
  const frame = useCurrentFrame();
  // 压暗 beat = 前一段亮画面叠化沉入本卡的近黑底,无需额外遮罩
  const mark = riseIn(frame, 4, 22);
  const main = riseIn(frame, VO12_AT);
  const sub = riseIn(frame, 58);
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 140% at 50% -10%, #14181f 0%, #0b0d11 55%, #07080a 100%)",
        fontFamily: FONT,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* 一点极淡的品牌光晕,保持朴素 */}
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          top: -320,
          left: 510,
          background: "radial-gradient(circle, rgba(122,162,255,0.10) 0%, transparent 62%)",
          filter: "blur(26px)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
        {/* 标识:文字 wordmark(产品 token 风格的暗底亮字,❌ 凭空 logo 图形) */}
        <div style={{ opacity: mark, translate: `0 ${(1 - mark) * 14}px`, textAlign: "center" }}>
          <div style={{ fontSize: 92, fontWeight: 700, color: "#f2f4f8", letterSpacing: 10 }}>
            咕咕
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 24,
              fontWeight: 600,
              color: "#7aa2ff",
              letterSpacing: 14,
              textTransform: "lowercase",
            }}
          >
            gugu
          </div>
        </div>
        {/* 主句 = VO12,与旁白同起 */}
        <div
          style={{
            opacity: main,
            translate: `0 ${(1 - main) * 16}px`,
            fontSize: 46,
            fontWeight: 600,
            color: "#eef1f7",
            letterSpacing: 2,
          }}
        >
          把方向交给你，把执行交给咕咕。
        </div>
        {/* 副行(路演锚) */}
        <div
          style={{
            opacity: sub * 0.85,
            translate: `0 ${(1 - sub) * 12}px`,
            fontSize: 24,
            fontWeight: 400,
            color: "#8b93a6",
            letterSpacing: 1.5,
          }}
        >
          让每个 agent 有社交身份：被发现、被分享、被邀请。
        </div>
      </div>
      <Sequence from={VO12_AT} layout="none">
        <Audio src={staticFile("vo/12.mp3")} />
      </Sequence>
    </AbsoluteFill>
  );
};
