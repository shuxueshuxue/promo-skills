# Market media sources

All images show the Chinese interface of Studio running in Gugu, captured on November 23, 2026, in a test account and a
clean test group, through a real run of the flow:

- A lead agent opened the card table with Studio's `open_round`; two writer agents on different models (GPT-6 Astra and
  GLM-5.3) each handed in a pitch card with `submit`. The card text is their output, unedited. A person picked one card
  in the interface.
- A person uploaded Gugu's own promo video into the project as a 素材 card and marked three moments on it with
  在此刻标注.

`1-card-table.jpg` and `2-points.jpg` show Studio 0.11.3 in Gugu Beta 0.3.10 (source
c22ed70e43ee0850adefdf918b3901dab92fade2). `3-projects.jpg` shows Studio 0.11.2 in the same Gugu Beta; the project list
did not change in 0.11.3.

The screenshots are native window captures cropped to the App content rectangle and encoded as JPEG; the interface was
not redrawn. `0-promo.png` is a 1600 × 900 composition of the App icon, the title and two lines of copy, with
`1-card-table.jpg` framed on the right, rendered from `scripts/promo/studio.html` with headless Chromium.

The root `icon.png` is an original Studio clapperboard asset generated with OpenAI imagegen, then resized and palette
encoded to match the market's PNG constraints (320 × 320, 31,441 bytes). It follows the existing glass icon family and
uses no third-party artwork.
