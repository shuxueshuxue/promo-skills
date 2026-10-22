// ─── PLACEHOLDER SYNTH SCENE — replace with YOUR product's second hand-authored scene ───
// See C1Pain.tsx for what a "synth" segment is. In the gugu reference film, `c2-local-idea`
// was a synthesized terminal shot of an idea being refined locally. Ships here as a labeled
// placeholder so the renderer skeleton compiles. Referenced by `comp: "c2-local-idea"` in
// cutlist.ts. Delete this segment from cutlist.ts if your film has no second synth scene.
import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { FONT, INK, INK_SOFT } from "./shared";

export const C2_LOCAL_IDEA_DURATION = 270; // frames @ 30fps (~9s)

export const C2LocalIdea: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, 16, C2_LOCAL_IDEA_DURATION - 16, C2_LOCAL_IDEA_DURATION], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: "#0d1117", fontFamily: FONT, alignItems: "center", justifyContent: "center", opacity: fade }}>
      <div style={{ textAlign: "center", maxWidth: 900, padding: 40 }}>
        <div style={{ fontSize: 22, letterSpacing: 4, color: "#7d8590", textTransform: "uppercase" }}>synth scene · c2-local-idea</div>
        <div style={{ fontSize: 52, fontWeight: 700, color: "#e6edf3", marginTop: 16 }}>
          Your second hand-authored scene goes here
        </div>
        <div style={{ fontSize: 22, color: "#9aa4b2", marginTop: 20, lineHeight: 1.5 }}>
          Replace <code>src/synth/C2LocalIdea.tsx</code>, or remove this segment from{" "}
          <code>final/cutlist.ts</code>.
        </div>
      </div>
    </AbsoluteFill>
  );
};
