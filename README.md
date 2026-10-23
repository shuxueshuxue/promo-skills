# 片场 · Studio

![在卡桌中比较不同讲法，查看方案与批注](screenshots/card-table.jpg)
![给一张方案卡填写修改意见](screenshots/annotate.jpg)

**在咕咕群里做片子：人说一句话，组长 agent 开一轮轮卡桌，几个不同模型的写手各交一版，人只管挑。**

1. 在群里跟组长说一句，比如「做条 15 秒的片子，介绍我们的记账小程序……分三轮：先出讲法，再挑声音，最后剪整片」。
2. 组长用片场开一张卡桌，排好几轮，每轮叫几个写手各交几张卡：讲法、文案、分镜、配音小样、整片……
3. 人在卡桌上看卡，可以批注、「选这张」或者打回。选中的卡会作为下一轮的参考。人也可以跳过一轮、暂停组长，或者自己开一轮。
4. 计划走完，组长在群里说一句片子做好了。

写手交片时，片场会先替人检查一遍：时长（不超过 10 分钟）、响度、最长无声、有没有黑屏或白屏。封面和缩略条由片场自动做。原片留在交卡的那台电脑上，卡桌上点一下就能播。

图像与配音使用在片场设置中配置的 OpenRouter 密钥，费用在卡桌顶部汇总。每张卡桌默认最多 8 轮，每轮最多 4 个写手，可在设置中调整。提交视频的设备需要安装 ffmpeg。片场 0.7.6 要求咕咕 0.2.55 或更新版本，以及 App API 4。

片场需要的权限：读取群文件及各设备上任务工作区内的原片；写入群文件和当前设备的任务文件，用于保存卡桌、封面、缩略条与配音；发送群内通知；向 Agent 提供工具。跨设备的任务文件只读。安装时由权限确认单说明并请求授权。

---

卡桌保存在来源群或私聊的文件夹；从话题打开时使用来源的共享槽和成员名册。话题不会自动获得另一张卡桌：继续制作时传已有 `board` 文件 id，需要另一项目时才新建。图片、封面、缩略条和提交的音频跟着卡桌文件的 `entry.chat`；原始片段仍按卡桌记录从制作设备读取。`settings.json`（密钥、默认写手和模型设置）继续仅保存在当前设备的 App 数据目录。

## promo-video：拍真产品的宣传片 skill

**A Claude Code / agent skill for making a real product launch video — by filming the
product's own running UI, not by rebuilding it in motion graphics.**

This is the distilled, reusable workflow behind a real 100-second product launch film,
shot end-to-end (the night before a demo day) by an agent driving the actual app. Every
rule in [`director-rulings.md`](skills/promo-video/references/director-rulings.md) was earned by a
real reviewer rejection.

### The idea in one line

> The footage is the real product, running. Everything cinematic — push-ins, cuts,
> captions, voiceover, music — is added in post as deterministic render-time data, so any
> clip can be re-shot verbatim after a note and re-rendered in minutes.

Three tools, fused:

| Pillar | Role |
|---|---|
| **Playwright / CDP** | drive & capture the real app at HD; a service-role harness forges realistic live state |
| **Remotion** | render engine — React *is* the video (frame-driven, deterministic, re-renderable); "variants" are just different props |
| **HyperFrames' knowledge structure** | the vocabulary of shooting techniques + the storyboard-then-approve-gate review loop |

### Two ways to use it — one skill folder

The skill is [`skills/promo-video/`](skills/promo-video/) (SKILL.md + references + toolkit + the worked example).
Nothing is copied between the two uses:

- **As a Claude Code skill** — copy that folder into `~/.claude/skills/` (or a project's `.claude/skills/`).
- **As 片场 (Studio), a gugu App** — the repo root is the App bundle: its manifest declares
  `contributes.skills: "skills"`, so every agent session on a computer that has the App gets this same skill, and the
  App's card table replaces the LAN review board.

### Quickstart

1. **Read [`SKILL.md`](skills/promo-video/SKILL.md).** It is the workflow, top to bottom. Then keep
   [`director-rulings.md`](skills/promo-video/references/director-rulings.md) open while you work.
2. Copy `skills/promo-video/toolkit/` into your film's folder and install it there (`npm install`, and again in
   `toolkit/renderer` for the Remotion renderer) — see the [toolkit README](skills/promo-video/toolkit/README.md).
3. Run the fragment loop per feature: orchestrate state → capture HD → assemble → review →
   iterate. Then shoot the **grand take** and assemble the final cut.

```
 0. UNDERSTAND   product → user stories → ONE coherent narrative (no redundancy)
 1. SCREENPLAY   acts + beats + voiceover; each feature = a fragment
 2. ORCHESTRATE  screenplay.json → timed service-role writes → realistic live state
 3. CAPTURE      drive the real app, record HD (CDP shot-loop @ real 2×)
 4. ASSEMBLE     frames → CFR mp4 + rebased events.json
 5. INGEST       fragments → renderer manifest
 6. VARIANTS     parameterized Remotion comps (zoom-follow, narration-overlay, …)
 7. REVIEW       LAN board, human rejects/annotates → feedback.jsonl → you iterate
 8. NARRATE      TTS (lines.json → id.mp3), captions timed to events
 9. FINAL CUT    ONE shared-world grand take → cutlist → camera + cuts + VO + BGM + CTA
10. QA           blackdetect blank-scan + VO↔picture alignment
```

### Layout

```
skills/promo-video/            the skill — one copy, read by Claude Code and by the gugu App
  SKILL.md                     the workflow (start here)
  references/
    director-rulings.md        the codex of scars — reject-driven rules (read alongside SKILL.md)
    capture-real-product.md    HD-capture bench: what won (CDP shot-loop @2×) and what died, with reasons
    orchestration-harness.md   forging realistic live state (the one product-specific adapter)
    variants-techniques.md     the "变式" vocabulary — zoom-follow, narration-overlay, and how to add more
    review-loop.md             the LAN review board protocol + status state machine
    final-assembly.md          the grand-take approach + cutlist source-of-truth + QA gate
    data-contracts.md          every JSON/TS schema in one place
  toolkit/                     runnable, product-agnostic tools (product-specific seams are marked)
    review-server.mjs          zero-dep LAN review board
    tts.mjs                    narration TTS (env-only keys; swap provider in synth())
    ingest.mjs                 fragments → renderer manifest
    capture/                   recorder-shotloop.ts (CDP HD recorder) + promo-assemble.mjs
    orchestration/             service-role state harness (adapter you implement for your backend)
    renderer/                  Remotion skeleton — lib/camera+edit+types, final/cutlist+FinalCut, QA
  examples/
    gugu-case-study.md         the real run, end to end, as a worked example
```

### What this is *not*

- Not a motion-graphics or talking-head generator — its first-class footage is a real product.
- Not turnkey. The capture harness and the intro/CTA scenes are yours to adapt; the pipeline,
  the camera/edit/assembly mechanism, the review loop and the QA gate are reusable as-is.

### Credits & lineage

Built by fusing three open efforts — [Remotion](https://www.remotion.dev/docs/ai/skills),
[GSAP skills](https://github.com/greensock/gsap-skills), and HeyGen's
[HyperFrames](https://github.com/heygen-com/hyperframes) — with a real-product Playwright/CDP
capture path. The gugu launch film is the reference implementation.

## License

MIT — see [LICENSE](LICENSE).
