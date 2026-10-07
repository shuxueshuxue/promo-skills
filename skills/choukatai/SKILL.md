---
name: choukatai
description: >-
  Work a 抽卡台 (card table) in gugu: several agents of different models each hand in cards for a creative round —
  a narrative, copy, a storyboard frame, a clip variant, a cut — a critic agent scores them against the director's
  rulings, and a person picks, annotates or rejects. Use when you are woken about a .chouka.json file, or asked to
  draw cards, judge cards or answer a rejected card. For filming a real product, follow the promo-video skill.
---

# 抽卡台 — drawing cards with several agents

Creativity in practice is drawing cards: many genuinely different tries, a person who picks, and the picks mixed into
the next round. On a 抽卡台 table you are one of several agents — usually of different models — so **your card is worth
the most when it is unlike the others'**. The person only picks, annotates and rejects; the rules come from
`promo-video/references/director-rulings.md` (23 rules, every one a past rejection) plus the rules added on the table.

## The tools

抽卡台's tools are `board`, `submit`, `note` and `image`. In your tool list they carry a prefix — in Claude Code
`mcp__plugin_gugu-product_choukatai__board` (and `…__submit`, `…__note`, `…__image`); elsewhere `choukatai__board`, or
only through `catalog_call` with tool `choukatai__board`. **Look in your own tool list first**: tools listed there are
left out of `catalog_list`, so an empty catalog does not mean you lack them. Only if neither has them, say so to the
person in one line — do not write the table file by hand: the tools stamp who you are and wake the critic, a hand edit
does neither.

## When you are woken

A whisper about a `.chouka.json` file means something on the table concerns you. Always start with the `board` tool
on that file. It tells you:

- `askedOfYou` — rounds that want cards from you: the kind (叙事 / 文案 / 分镜 / 变式 / 片头 / 整片 / 宣传稿), the slot,
  the person's ask, how many cards (`each`), how many you have handed in, and the picked cards to build on (`refs`);
- `criticOf` — rounds you judge, and which cards still wait for your note;
- `feedbackOnYours` — notes and rejects on your cards; `answered: false` means a new version is owed;
- `rules.added` — rules this table promoted from rejections. They bind as hard as the 23.

## Handing in a card (`submit`)

1. Read the brief, the round's ask and its `refs`. A round after a pick builds on the pick: say which cards you mix in
   `parents`.
2. Make **`each` cards that differ from each other** — different angle, structure, tone — not one idea reworded.
3. A card is a short title the person can pick by, plus `text` (markdown) and/or `files`:
   - images (storyboard frames, posters): make them with 抽卡台's `image` tool — the person's image model, the same for
     every writer whatever harness it runs in. Write the prompt as the frame itself (subject, composition, what must be
     on screen); pass `references` (absolute paths) to keep a mascot's or a product screenshot's look. It answers a file
     path: put that file in **the same chat** with `workspace_upload_file` (`mime_type` `image/png`) and give the item
     ids in `files`. If it says there is no key yet, hand in a precise frame description and say so — never draw the
     frame with a script instead. A harness with its own image tool (Codex) may use that; upload it the same way;
   - clips: real product footage follows the promo-video skill (capture, assemble, a variant render); intros and moods
     may come from a video API. Upload the review render (720p is plenty; the master stays on the machine that rendered it).
4. Report `cost`: `usd` is what the media API itself reported (the `image` tool's `usd`, a video API's `usage.cost`),
   `seconds` the wall time the card took, `tokens` your own approximate count. Leave out what you cannot know; never
   guess dollars.
5. One `submit` per card. To answer a reject, `submit` again with `card` set to your card: that makes a new version,
   which is what turns the person's reject into "待复审". Someone else's card is never edited — cite it in `parents`.

**Never post cards into the chat timeline**, and do not announce them: the table is where they live, and the person
was already told. A plain question to the person is fine.

## Judging a round (`note`)

You are woken once the round is in. For every card: read it (look at its images and clip frames — the frames a zoom
lands on and the first frame of each voice line), then `note` it 0–10 with one line that names the rule it keeps or
breaks (`§3 因果断了`, `§20 旁白开头的画面不是主语`). Score what it does for the brief, not how much work went in. 4 or
below folds the card away from the person; they can still open it. You never note your own card. When a `note`
answers `tellThePerson`, the round is fully judged: whisper that one line to the person as it says — the only message
you send for a round.

## What the person does (so you know what their marks mean)

- **选这张** — this card is the slot's choice; the next round builds on it.
- **批注** — a note, not a rejection. Use it in your next version or the next round.
- **打回** — rejected. A new version of the card answers it. If they ticked **升为规矩**, the comment is now a rule.

There is no "approve": a card is accepted when no reject of it is newer than its latest version.
