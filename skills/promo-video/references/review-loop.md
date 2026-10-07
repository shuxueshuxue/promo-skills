# The LAN Review Board

A single-file, zero-dependency review server (`toolkit/review-server.mjs`) that turns a folder of
rendered promo artifacts into a browsable review site your director/stakeholders open on the same
LAN. Its whole job is to collect **feedback** — nothing else — and hand that feedback to an agent
that iterates. The design is deliberately boring so it never fights the reviewer.

## Why it exists (the design constraints)

1. **Zero dependencies.** Pure `node:http` + `node:fs`. `node review-server.mjs` and it runs —
   no install step, no build, nothing to break on a fresh machine. One `PORT` env var
   (`const PORT = Number(process.env.PORT || 7799)`) is the only configuration.

2. **Flicker-free — no client polling.** The board never auto-refreshes and never long-polls.
   The index is a static render; each artifact has its **own dedicated URL** (`/frag/<id>`,
   `/story/<name>`, `/music`, `/vo`). A reviewer opens a page, scrubs a video, types a note,
   submits — and the page stays put. Nothing "jumps" under their cursor. (Contrast: a live
   dashboard that repaints every few seconds is unusable for watching a 10s clip frame by frame.)

3. **Range-served media so video scrubs.** `serveFile()` honors HTTP `Range` requests and replies
   `206 Partial Content` with `Accept-Ranges: bytes`, streaming `fs.createReadStream(file, {start, end})`.
   That is what lets a `<video controls>` seek instantly instead of downloading the whole file first.

   ```js
   if (range) {
     const m = range.match(/bytes=(\d*)-(\d*)/)
     const start = m[1] ? Number(m[1]) : 0
     const end = m[2] ? Number(m[2]) : stat.size - 1
     res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`,
       'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type })
     fs.createReadStream(file, { start, end }).pipe(res)
   }
   ```

4. **Reject or annotate — there is no Approve button.** Reviewers can only leave a note
   (`verdict: 'note'`) or push back (`verdict: 'reject'`). Approval is **implicit**: a fragment is
   accepted precisely when there is no open rejection newer than its latest render. This removes the
   "did someone forget to click approve?" ambiguity — silence on a fresh render *is* the pass.

## The filesystem is the database

There is no DB, no state file the server writes to describe status. Status is **derived on every
request** from two things only:

- **File mtimes** on disk — when each artifact/render was last written.
- **The append-only event log** `review/feedback.jsonl`.

Nothing else. Delete a render and the fragment goes back to "工作中" (in progress). Drop in a newer
render and a previously-rejected fragment flips to "待复审" (awaiting re-review). The directory tree
*is* the source of truth; the server is a pure function over it.

### What counts as a fragment

A subdirectory of `fragments/` is a reviewable fragment **iff it contains `story.md`**:

```js
fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'story.md')))
```

No `story.md` → not shown. This is the on/off switch: an agent "publishes" a fragment for review by
writing its story file, and un-publishes by removing it.

### How variants are discovered

A fragment's rendered **variants** are matched purely by render filename convention
`renders/<id>--<variant>.{mp4,webm}`:

```js
fs.readdirSync(rdir)
  .filter((f) => f.startsWith(id + '--') && /\.(mp4|webm)$/.test(f))
  .map((f) => ({ name: f.slice(id.length + 2).replace(/\.(mp4|webm)$/, ''),
                 file: '/renders/' + f, mtime: fs.statSync(path.join(rdir, f)).mtimeMs }))
```

So `renders/act1-add--zoom-follow.mp4` and `renders/act1-add--narration.mp4` become two selectable
variants of fragment `act1-add`, each carrying its own `mtime` (the render timestamp that the state
machine compares against feedback). See `variants-techniques.md` for what a variant *is*.

## The feedback event shape

Every submission is one JSON object appended as one line to `review/feedback.jsonl`. The server
stamps `ts` server-side and merges the client payload:

```js
fs.appendFileSync(FEEDBACK, JSON.stringify({ ts: new Date().toISOString(), ...JSON.parse(body) }) + '\n')
```

The full event shape:

```jsonc
{
  "ts":      "2026-07-09T12:34:56.000Z", // ISO timestamp, stamped by the server on receipt
  "kind":    "fragment",                 // fragment | story | music | vo — which surface
  "id":      "act1-add",                 // fragment/story id (absent for singleton surfaces)
  "verdict": "note",                     // "note" (annotate) or "reject" (push back)
  "pick":    "zoom-follow",              // which variant the reviewer prefers (radio, optional)
  "comment": "推近太猛,第二拍慢半拍",     // free text
  "who":     "director"                  // signer, remembered in localStorage
}
```

`kind` routes the note to a surface; `id` scopes it within that surface; `pick` records a variant
preference so the assembler knows which take won; `verdict` drives the state machine below. JSONL
(one object per line, append-only) means the log is a durable, greppable, tail-able history — never
rewritten, so every round is recoverable.

## The wake loop (external watcher, not the server)

The server does **not** notify anyone. It just appends. An **external watcher** owns the wake:
`tail -f review/feedback.jsonl`, a file-watch hook, or a Claude Monitor rule points at that file and
wakes the iterating agent when a new line lands. The agent reads the new event(s), does the work
(re-shoot, re-render, rewrite the story), and the next page load reflects the change because status
is recomputed from mtimes. Clean separation: the server collects, the watcher triggers, the agent
acts. No websockets, no server-side agent coupling.

## The status state machine

`statusOf(f, fb)` derives a fragment's state from its render mtimes vs. its feedback events. Two
states are highlighted: **待审批 / 待复审** (something is waiting for a human) and **工作中** (the agent
is shooting/fixing). The exact transitions (`fb` = this fragment's feedback events, oldest→newest;
`latestRender` = max mtime across its variants):

| Condition | State | Meaning |
|---|---|---|
| No variants rendered yet | **工作中** | shooting (or `renders/` empty) / rendering if `raw/` has footage |
| Variants exist, **no feedback** | **待审批** | first round, unreviewed |
| Last event is `reject`, **latestRender > rejectTs** | **待复审 第 N 轮** | re-rendered *after* the rejection — ready for another look |
| Last event is `reject`, latestRender ≤ rejectTs | **工作中** | rejected, agent still fixing |
| Last event is a `note`, latestRender > noteTs | **待复审** | new version cut after the note |
| Last event is a `note`, latestRender ≤ noteTs | **待审批** | annotated but not rejected, no new cut |

The round counter is just `rejects + 1` where `rejects = fb.filter(x => x.verdict === 'reject').length`.
The load-bearing comparison is always **render mtime vs. the timestamp of the latest reject** — a
reject is "answered" the moment a newer render exists, which is exactly the implicit-approval rule.
Code:

```js
function statusOf(f, fb) {
  const rejects = fb.filter((x) => x.verdict === 'reject').length
  if (!f.variants.length) return { state: '工作中', ... }          // nothing to review
  const latestRender = Math.max(...f.variants.map((v) => v.mtime))
  if (!fb.length) return { state: '待审批', detail: '首轮 · 未批', ... }
  const last = fb[fb.length - 1]
  const lastTs = Date.parse(last.ts)
  if (last.verdict === 'reject') {
    if (latestRender > lastTs) return { state: '待复审', detail: `第 ${rejects + 1} 轮 · 已按批注重渲` }
    return { state: '工作中', detail: `第 ${rejects} 次被打回 · 整改中` }
  }
  if (latestRender > lastTs) return { state: '待复审', detail: '批注后有新版本' }
  return { state: '待审批', detail: '有批注 · 未打回' }
}
```

Because there is no persisted status, this can never drift out of sync with reality: touch a file,
the status changes. Nothing to migrate, nothing to reconcile.

## Page structure

- **`/` index** — grouped result catalog. Fragments are bucketed by an `act` field from each
  fragment's optional `meta.json` (`{title, desc, act, order, role, vo}`), ordered by `order`. Two
  running counters in the header — how many are `待审批` vs `工作中` — give the reviewer an at-a-glance
  worklist. Non-fragment surfaces (story scripts, music candidates, VO lines) get their own rows.
- **`/frag/<id>`** — one fragment: every variant as a `<video>` with a radio to `pick` it, links to
  raw footage, a collapsible `story.md`, a comment box, and **Submit note** / **❌ Reject** buttons.
  A deleted fragment resolves to a friendly "this fragment no longer exists" page, not a 404 —
  because a director instruction to cut a scene is a normal event, not an error.
- **Singleton surfaces** (`/story/<name>`, `/music`, `/vo`) — same annotate/reject affordance for
  the non-video assets (screenplay text, background-music candidates, narration takes).

## Running it

```bash
PORT=7799 node toolkit/review-server.mjs
# → review-server v2 (multi-page) on http://localhost:7799
# Share the LAN IP (http://<host>:7799) with reviewers.
# Point a watcher at review/feedback.jsonl to wake the iterating agent:
tail -f review/feedback.jsonl
```

Directory contract the server reads (all relative to the server's parent dir):

```
fragments/<id>/story.md          # presence => this fragment is reviewable
fragments/<id>/meta.json         # optional: {title, desc, act, order, role, vo}
fragments/<id>/raw/*.{webm,mp4}  # source footage, linked from the detail page
renders/<id>--<variant>.{mp4,webm}   # rendered variants (filename = discovery)
review/feedback.jsonl            # append-only event log (the "database")
stories/*.md, music/*.mp3, vo/lines.json   # singleton review surfaces
```
