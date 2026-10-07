// ─── PLACEHOLDER SYNTH SCENE — replace with YOUR product's opening/hero scene ───
// A "synth" segment is a fully-authored React/Remotion scene (not real footage): the film's
// prologue, hero shot, or any moment you want to hand-draw rather than screen-record.
// In the gugu reference film, `c1-pain` was a one-take 3D-office montage dramatizing the pain
// the product solves. Yours will be different — so this ships as a labeled placeholder that
// renders a card, keeping the renderer skeleton internally consistent (no dangling imports).
//
// The final cut references this by the `comp: "c1-pain"` key in cutlist.ts. Keep the export
// names (`C1Pain`, `C1_PAIN_DURATION`) or rename here + in cutlist.ts + FinalCut.tsx + Root.tsx.
import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { FONT, INK, INK_SOFT } from "./shared";

export const C1_PAIN_DURATION = 580; // frames @ 30fps (~19s) — set to your scene's length

type C1Narration = { text: string; atFrames: number }[];

export const C1Pain: React.FC<{ narration?: C1Narration }> = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 20, C1_PAIN_DURATION - 20, C1_PAIN_DURATION], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: "#f5f6f8", fontFamily: FONT, alignItems: "center", justifyContent: "center", opacity: fade }}>
      <div style={{ textAlign: "center", maxWidth: 900, padding: 40 }}>
        <div style={{ fontSize: 22, letterSpacing: 4, color: INK_SOFT, textTransform: "uppercase" }}>synth scene · c1-pain</div>
        <div style={{ fontSize: 56, fontWeight: 700, color: INK, marginTop: 16, lineHeight: 1.2 }}>
          Your product's opening / hero scene goes here
        </div>
        <div style={{ fontSize: 24, color: INK_SOFT, marginTop: 20, lineHeight: 1.5 }}>
          Replace <code>src/synth/C1Pain.tsx</code> with the bespoke React/Remotion scene that
          dramatizes the pain your product solves. Everything around it — camera, cuts, VO, BGM
          ducking — is reusable as-is.
        </div>
      </div>
    </AbsoluteFill>
  );
};
