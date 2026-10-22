# Case study — 《一个 idea 的旅程》 (gugu, 101.6s)

The reference implementation: the launch film this skill was distilled from. gugu is an
agent-social / chat client (humans and AI agents collaborate on long-running work in shared
groups). The film was shot end-to-end by an agent fleet the night before a demo day. This
walks the real run stage by stage — use it as a template, not gospel.

## 0 · Understand → the one narrative

The trap the director kept rejecting: **shooting gugu as a better IM.** Add-friend, read
receipts, unread badges are commodity (rulings §2). The distinctive thing is *a human and their
agents carrying an idea from a private local thought all the way to a published research result,
as a team.* So the whole film became one journey — "the journey of an idea" — with a hard rule:
no redundancy, every beat earns the next (§3).

Final feature list, folded into one causal spine:
1. the pain — knowledge doesn't carry across people/agents;
2. an idea, refined locally with an agent (codex terminal);
3. one-click that agent to the cloud — its own sandbox, own model, carrying the memory;
4. install a domain skill onto it;
5. a professor *shares the agent* (not a doc — a whole train of thought) with a student;
6. a new collaborator joins → add contact;
7. summon a ready-made research squad from the workbench;
8. humans inject insight, agents take the work;
9. the plan is finalized in back-and-forth, agents run overnight;
10. every output logged in the right-hand sidebar;
11. results aren't a one-off — every discipline can do this (plaza / feed);
12. CTA — "you set the direction, gugu runs it."

## 1 · Screenplay → fragments

Each beat became a fragment (`fragments/<id>/` with `story.md` + `meta.json`). IDs:
`c1-pain`, `c2-local-idea`, `m1-agent-birth`, `m1c-skill-install`, `m2-agent-share`,
`h1-team-import`, `h2-research-group`, `m4-collab`, `m5-plaza`, `f3-mobile-shell`, …
The 12 VO lines (one voice, `Chinese (Mandarin)_Reliable_Executive` @ speed 1.18) were written
plain (§9) and revised by the director several times — e.g. line 1:
> 「同一个问题，问了四遍。资料散在五个地方。没有一个 Agent 能够了解你想法的全部脉络。」

## 2 · Orchestrate a lived-in world

A fresh account looked like a toy (§4), so the screenplay harness seeded a shared world:
people 周明远/林晓/陈屿/苏芮(friendships written both directions), the agent 「凝聚态·灵感体」,
the group 「章鱼研究所」, and chat history at the water-line of a mid-project team — then
`perform` fired the live beats on a timeline, `teardown` verified zero residue (shared prod DB).

## 3 · Capture — the clarity gate that reshaped everything

The director looked at the first `recordVideo` cut and rejected it: **"too blurry."** That one
note became acceptance gate §14 — *clean at 2.6× zoom* — and forced a whole capture investigation
(`references/capture-real-product.md`). A dedicated研究员 benched six methods; **CDP shot-loop @
real 2×** won (3200×2000, jpeg q100, ~19 fps on real pages). screencast, trace, OS capture,
beginFrame, MediaRecorder all died with documented reasons. Every fragment was re-shot with the
winner.

## 7 · Review loop

`review-server.mjs` ran on the Mac mini's LAN so the director *and their collaborators* could
watch. Real rejections that became rules:
- f3 (mobile) v1 was a menu-ordering chit-chat clip → rejected (§5 no small talk);
- "什么叫玻璃岛？'出口永远在左上角'…你是宣传视频不是说明书啊" → §6 no manual-speak;
- "太垃圾了，做的跟玩具似的，而且搞得像传统 IM 工具一样" → §2/§4.
Each `reject` in `feedback.jsonl` woke the agent (Monitor tailing the file) into the next round.

## 9 · The grand take (not a stitch)

The director watched a stitched cut and rejected it: *disjointed, init too long, state jumps,
pacing off.* That produced §17 (shared state) and the grand-take plan (`final-assembly.md`): one
continuous world, one session, shot in acts (`act1a … act5`), assembled in Remotion via
`cutlist.ts`. Late corrections folded into rules: §21 (one VO track per act — a two-timbre
prologue accident), §22 (final 1.25× speed-up, VO/BGM not sped), §20 (VO↔picture alignment is the
#1 acceptance item), §23 (render on the capture machine, transfer only the mp4).

When the deadline got tight (2 a.m., demo at 9), the team ran **saturation rescue**: two
independent lanes (A/B) re-mastering the same 2:03 cut, no cross-talk, best cut wins.

## 10 · QA & the result

`final-cut-qa.mjs` gated every re-source: duration ±0.5s, `blackdetect` blank-scan (zero hits —
a 1.8s white loading frame was cut, not waved through), and a per-line VO↔picture frame dump.
Final: **101.6s, 1080p30, one voice across 13 tracks, blank-free, every line aligned to its
subject.** Two things disclosed honestly rather than faked: 101.6s is near the physical floor
(21.7s of un-sped VO), and one 99%-empty micro-shot was pulled rather than shipped dead.

## The takeaway

The film is good because the **rejections were kept as rules**. Nothing here was a lucky first
try — `references/director-rulings.md` is 23 scars, and every one of them started as a clip that
came back with a note.
