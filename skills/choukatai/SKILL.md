---
name: choukatai
description: >-
  Work a 抽卡台 (card table) in gugu: several agents of different models each hand in cards for a creative round —
  a narrative, copy, a storyboard frame, a clip variant, a cut — and the people in the chat annotate, pick or reject
  them. Use when you are woken about a .chouka.json file, or asked to draw cards, look at cards or answer a rejected
  card. For filming a real product, follow the promo-video skill.
---

# 抽卡台 — drawing cards with several agents

Creativity in practice is drawing cards: many genuinely different tries, a person who picks, and the picks mixed into
the next round. On a 抽卡台 table you are one of several agents — usually of different models — so **your card is worth
the most when it is unlike the others'**. The people in the chat annotate, pick and reject; the rules come from
`promo-video/references/director-rulings.md` (23 rules, every one a past rejection) plus the rules added on the table.

## The tools

抽卡台's tools are `board`, `submit`, `note` and `image`. In your tool list they carry a prefix — in Claude Code
`mcp__plugin_gugu-product_choukatai__board` (and `…__submit`, `…__note`, `…__image`); elsewhere `choukatai__board`.
**Look in your own tool list first.** One that is not there — your session started before the App was given to this
chat, or before an update added the tool — is still reachable: `catalog_call` with tool `choukatai__image` (or
`choukatai__board`, …) runs it, even when `catalog_list` does not show it. Only if that fails too, say so to the
person in one line — do not write the table file by hand, and do not call the App's services yourself: the tools stamp
who you are and tell whom it concerns, a hand edit does neither. **Never read 抽卡台's own settings file** (`settings.json` in
the App's data folder): it holds the person's own key, which the `image` tool uses for you — read, it would go into
your context and on to your model's provider.

## When you are woken

A whisper about a `.chouka.json` file means something on the table concerns you. Always start with the `board` tool
on that file. It tells you:

- `askedOfYou` — rounds that want cards from you: the kind (叙事 / 文案 / 分镜 / 变式 / 片头 / 整片 / 宣传稿), the slot,
  the person's ask, how many cards (`each`), how many you have handed in, and the picked cards to build on (`refs`);
- `feedbackOnYours` — notes and rejects on your cards; `answered: false` means a new version is owed;
- `cards` — every card with its status and the latest notes on it;
- `rules.added` — rules this table promoted from rejections. They bind as hard as the 23.

## Handing in a card (`submit`)

1. Read the brief, the round's ask and its `refs`. A round after a pick builds on the pick: say which cards you mix in
   `parents`.
2. Make **`each` cards that differ from each other** — different angle, structure, tone — not one idea reworded.
3. A card is a short title the person can pick by, plus `text` (markdown) and/or `files`:
   - storyboard frames: the film shows **the real product**, so a frame is first of all a precise shot — which screen,
     in which state (what is on it, who has said what), the camera's move — that the capture step then films for real
     (promo-video skill). Hand that in as the card's text. Pictures help the person pick: a real screenshot or recording
     frame of that screen is best; a drawn frame (抽卡台's `image` tool, the person's image model; a Codex agent's own
     image tool) is a sketch of the composition, never the product. Put each picture in **the same chat** with
     `workspace_upload_file` (`mime_type` `image/png`) and give the item ids in `files`. When the `image` tool says it
     cannot draw, take its answer as it is — the description is the card — and never draw the frame with a script;
   - posters and key visuals: 抽卡台's `image` tool, uploaded the same way (`references`, absolute paths, keep a
     mascot's or a screenshot's look);
   - clips: real product footage follows the promo-video skill (capture, assemble, a variant render); intros and moods
     may come from a video API. Upload the review render (720p is plenty; the master stays on the machine that rendered it).
4. Report `cost`: `usd` is what the media API itself reported (the `image` tool's `usd`, a video API's `usage.cost`),
   `seconds` the wall time the card took, `tokens` your own approximate count. Leave out what you cannot know; never
   guess dollars.
5. One `submit` per card. To answer a reject, `submit` again with `card` set to your card: that makes a new version,
   which is what turns the person's reject into "待复审". Someone else's card is never edited — cite it in `parents`.

**Never post cards into the chat timeline**, and do not announce them: the table is where they live, and the person
was already told. A plain question to the person is fine.

## When someone asks you to look at cards (`note`)

You look at cards when a person asks you to (in the chat, or in a whisper). Read the table with
`board` first — the cards, their images and clip frames (the frames a zoom lands on and the first frame of each voice
line), and the notes already on them. Then `note` each card you have something to say about: one or two lines on what
works and what to change, naming the rule when one applies (`§3 因果断了`, `§20 旁白开头的画面不是主语`). No score: you
say what you see, the person decides. Picking and rejecting are the person's, not yours. Notes go on the table, not into
the chat timeline; when you are done, one line to whoever asked is enough.

## What the person does (so you know what their marks mean)

- **选这张** — this card is the slot's choice; the next round builds on it.
- **批注** — a note, not a rejection. Use it in your next version or the next round. An agent's `note` is the same thing.
- **批注 with 「要作者交新版」 ticked** — 打回 (rejected). A new version of the card answers it. If they ticked
  **升为规矩**, the comment is now a rule.

There is no "approve": a card is accepted when no reject of it is newer than its latest version.
