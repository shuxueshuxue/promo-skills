# 片场 (Studio) — changes

## 0.6.0 (2026-10-12)

- **Narration (`voice`):** a film's lines, each with the second it starts, are spoken with the voice model on the
  person's key (OpenRouter, the key pictures use; the voice is picked in the table's settings), laid on one track at
  -16 LUFS in place of the film's sound — the picture is copied, not re-encoded — as `<film>.voiced.mp4` beside it.
  A line that runs into the next is refused with how much it is over and about how many characters fit at the pace it
  was said; a line said before in the same voice is not bought again. No key, no voice: there is no placeholder.
- **Voice samples:** one line in several voices, each handed in as its own card (`submit → audio`), which plays it.
- **What the table has cost:** what `voice` and `image` pay is written on the table and summed at its top (配音 · 出图).
  `image` now takes the table (`board`) for that.

## 0.5.0 (2026-10-12)

- **Renamed from 抽卡台 to 片场 (en: Studio)**, and its ids with it: the App is `studio`, table files are
  `*.studio.json`, the skill is `skills/studio` (tools `studio__…`). This version does not open a table written as
  `.chouka.json`, and it installs beside the old App rather than over it: a table made with 抽卡台 opens only with
  抽卡台 (or after renaming the file). Nobody had it installed outside the test rigs.
- **A clip is handed in by its path alone.** submit reads it where it was made — length, size, loudness, the longest
  silence, black or white screens — and refuses one with no picture, one nobody can hear, or one longer than 10
  minutes. It makes the cover and the strip of 8 frames itself and puts them in the table's chat.
- **Why the App now asks for `files:write`:** putting that cover and strip (and, from the next version, voice samples)
  into the table's chat is the one thing it writes. The consent sheet says more than that — "Change the files of every
  chat you are in, and of the tasks on this computer" — because the platform grants files:write as one word; the App
  uses it only for those uploads, into the chat the table is in.
