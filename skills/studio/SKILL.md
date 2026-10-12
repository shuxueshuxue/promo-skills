---
name: studio
description: >-
  Work a 片场 (Studio) card table in gugu: several agents of different models each hand in cards for a creative round —
  a narrative, copy, a storyboard frame, a clip variant, a cut — and the people in the chat annotate, pick or reject
  them. Use when you are woken about a .studio.json file, or asked to draw cards, look at cards or answer a rejected
  card. For filming a real product, follow the promo-video skill.
---

# 片场 (Studio) — drawing cards with several agents

Creativity in practice is drawing cards: many genuinely different tries, a person who picks, and the picks mixed into
the next round. On a 片场 table you are one of several agents — usually of different models — so **your card is worth
the most when it is unlike the others'**. The people in the chat annotate, pick and reject; the rules come from
`promo-video/references/director-rulings.md` (23 rules, every one a past rejection) plus the rules added on the table.

## The tools

片场's tools are `board`, `submit`, `note`, `image`, `voice` and, for the agent leading a film, `open_round`. In your tool
list they carry a prefix — in Claude Code `mcp__plugin_gugu-product_studio__board` (and `…__submit`, `…__note`,
`…__image`, `…__voice`, `…__open_round`); elsewhere `studio__board`.
`image` and `voice` take the table (`board`) too: what they pay the person's media service is added to the table's
total, which the person sees on it.
**Look in your own tool list first.** One that is not there — your session started before the App was given to this
chat, or before an update added the tool — is still reachable: `catalog_call` with tool `studio__image` (or
`studio__board`, …) runs it, even when `catalog_list` does not show it. Only if that fails too, say so to the
person in one line — do not write the table file by hand, and do not call the App's services yourself: the tools stamp
who you are and tell whom it concerns, a hand edit does neither. **Never read 片场's own settings file** (`settings.json` in
the App's data folder): it holds the person's own key, which the `image` tool uses for you — read, it would go into
your context and on to your model's provider.

## When you are woken

A whisper about a `.studio.json` file means something on the table concerns you. Always start with the `board` tool
on that file. It tells you:

- `askedOfYou` — rounds that want cards from you: the line it is a step of (`track`: 片子, 文字…), the kind (叙事 / 文案 /
  分镜 / 变式 / 片头 / 整片 / 宣传稿), the slot,
  the person's ask, how many cards (`each`), how many you have handed in, and the picked cards to build on (`refs`);
- `feedbackOnYours` — notes and rejects on your cards; `answered: false` on a **reject** means a new version is owed;
  on a note it only means no newer version has come in since — use it, nothing is owed;
- `cards` — every card with its status and the latest notes on it;
- `rules.added` — rules this table promoted from rejections. They bind as hard as the 23;
- `lead` — the agent leading the table (`isYou`), its `plan`, the round it waits on (`waitingFor`), whether the person has
  taken over (`pausedByPerson`), and the `limits`.

## Leading a film (`open_round`)

When the person asks the group for a film ("做条 xx 的片子") and it is you they ask, you lead: you plan the rounds and
open them; the writers hand in cards; the person picks and rejects. You hand in no cards and never pick.

1. **First call** — no `board`: give `chat` (this chat's id, from the message that asked you), `title` (the film's
   name), `brief` (what they asked, in a sentence or two), the first `round` and the `plan` of the rounds after it. It
   makes the table in the chat and its link reaches everyone. A general film (screenshots, text cards, drawn frames,
   narration) usually runs 叙事 (the story in beats) → 分镜 (a frame per beat) → 配音 (voice samples, one per card; the
   person picks the voice) → 整片 (the cut with its narration); fit the plan to the ask.
2. **Writers**: agents in the chat other than you, of different models where the chat has them — the table is worth the
   most when the cards differ. Two or three a round, one or two cards each, unless the ask needs more; the limits are
   the table's (4 writers, 8 rounds by default; the person can change them).
3. **The ask** says what to build on — every pick so far is the round's `refs` unless you name others — and what to
   hand in (for 整片: the voiced film, `video`, at most 10 minutes).
4. **Then wait.** You are woken when the person picks from a round or skips it: read `board`, then open the next round
   from your plan (rewrite the plan if the person changed course in the chat). Until then `open_round` refuses, and that
   is the point — do not ask again or nudge anyone. If the person has taken the table over, wait until it is handed
   back. At the table's round limit, ask the person once whether to go on.
5. When the last planned round has a pick, tell the person in one line in the chat that the film is done, naming the
   picked card.

## Handing in a card (`submit`)

1. Read the brief, the round's ask and its `refs`. A round after a pick builds on the pick: say which cards you mix in
   `parents`.
2. Make **`each` cards that differ from each other** — different angle, structure, tone — not one idea reworded.
3. A card is a short title the person can pick by, plus `text` (markdown) and/or `files`:
   - storyboard frames: the film shows **the real product**, so a frame is first of all a precise shot — which screen,
     in which state (what is on it, who has said what), the camera's move — that the capture step then films for real
     (promo-video skill). Hand that in as the card's text. Pictures help the person pick: a real screenshot or recording
     frame of that screen is best; a drawn frame (片场's `image` tool, the person's image model; a Codex agent's own
     image tool) is a sketch of the composition, never the product. Put each picture in **the same chat's** group
     folder (as `image/png`) and give the item ids in `files`. When the `image` tool says it
     cannot draw, take its answer as it is — the description is the card — and never draw the frame with a script;
   - posters and key visuals: 片场's `image` tool, uploaded the same way (`references`, absolute paths, keep a
     mascot's or a screenshot's look);
   - clips: real product footage follows the promo-video skill (capture, assemble, a variant render); intros and moods
     may come from a video API. Hand in the review render (720p is plenty, and it must be at most 25 MB — the largest
     file the table can play; the master stays on the machine that rendered it). It stays where you rendered it too —
     hand it in with `video`, not `files`:
     `video.path` is that render in your working copy (relative, e.g. `renders/cut.720p.mp4`) — that is all you give.
     The tool reads the clip where you work: it checks it (length, loudness, the longest silence, black or white
     screens — a clip nobody can hear is refused, so mux the narration in first; so is one longer than 10 minutes), makes its cover and its strip of 8
     frames and puts those two in the chat, and keeps the clip's size and hash. The check comes back in the answer and
     goes on the card; the person plays the clip from the table, read from your machine. Don't move or overwrite it
     after you hand it in — a new cut is a new version of the card;
   - narration: cut the picture first, then `voice` with `film` (its path in your working copy) and `lines` — each
     `{ text, at }`, `at` the second the line starts, in the order spoken. It speaks every line in the table's voice,
     lays them on one track at -16 LUFS in place of the film's sound and answers `renders/<film>.voiced.mp4`: hand that
     in with `video`. A line that runs into the next is refused with how much it is over and about how many characters
     fit — shorten it to that, or move the next line later, and call `voice` again (lines already spoken are not paid
     for twice). There is no placeholder voice: without the person's key, ask them for it in one line;
   - voice samples (a round that picks the voice): `voice` with `sample` (one line from the film) and `voices` →
     one mp3 per voice; hand **each in as its own card** with `audio: { path }`, the voice's name in the title. The card
     plays it.
4. Report `cost`: `usd` is what the media API itself reported (the `image` or `voice` tool's `usd`, a video API's `usage.cost`),
   `seconds` the wall time the card took, `tokens` your own approximate count. Leave out what you cannot know; never
   guess dollars.
5. One `submit` per card. To answer a reject, `submit` again with `card` set to your card: that makes a new version
   (the one it replaces is kept, so the person can compare them), which is what turns the person's reject into
   "待复审". Someone else's card is never edited — cite it in `parents`.

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
- **批注** — a note, not a rejection; it wakes nobody — you find it on the table (`board` → `feedbackOnYours`). Use it in
  your next version or the next round. An agent's `note` is the same thing.
- **批注 with 「要作者交新版」 ticked** — 打回 (rejected). A new version of the card answers it — or the person picking it
  again, which takes the reject back. If they ticked **升为规矩**, the comment is now a rule.

There is no "approve": a card is accepted when no reject of it is newer than both its latest version and
its latest pick.
