# The orchestration harness

How to make a real product *look lived-in* on camera — and clean up after yourself when you
share a database with production.

---

## Why: a blank account is a toy

The demoed app has to look like someone has been *using* it — populated contact lists,
groups with history, agents mid-task, unread badges, presence dots. A freshly minted account
with one empty conversation reads as a toy demo, no matter how good the UI is. But you cannot
hand-click all that state into existence reproducibly, in the right time order, timed to a
recording take.

So the state is **orchestrated**: a script mints the accounts, wires the relationships, backfills
message history at believable ages, seeds presence — and then, *during* the take, drives a
time-ordered timeline of new events straight into the backend so they arrive over realtime and
animate on the recording UI exactly when the shot needs them.

The reference implementation is a single harness script driven by a `screenplay.json` per shot,
run in three phases. The **phase model and the JSON schema are reusable**; the actual database
writes are the one product-specific part you implement against your own backend (see "The one
adapter" below).

---

## The phase model

```
node run.mjs <screenplay.json> --phase prepare  --state state.json   # mint & backfill
node run.mjs <screenplay.json> --phase perform  --state state.json   # timed live writes
node run.mjs <screenplay.json> --phase teardown --state state.json   # reverse-order delete + verify
```

`prepare` writes a `state.json` mapping every screenplay ref to the real IDs it created; `perform`
and `teardown` read it back. Keeping IDs in a state file (not regenerated) is what lets teardown
delete *exactly* what prepare made.

### prepare — build the lived-in world

Runs in dependency order, each step failing loud:

1. **Humans** — mint auth accounts. Provisioning may lag: after `createUser` the downstream
   identity row can be absent for a beat, so **poll until it lands** before proceeding:

   ```js
   const { data } = await admin.auth.admin.createUser({
     email, password: PASSWORD, email_confirm: true,
     user_metadata: { nickname: spec.name, display_name: spec.name },
   })
   const userId = data.user?.id
   // identity row can lag — poll up to 60×400ms until the row is writable
   for (let i = 0; i < 60; i++) {
     const { data: rows } = await identityAdmin.from('users')
       .update({ display_name: spec.name }).eq('id', userId).select('id')
     if (rows?.length) { state.humans[ref] = { userId, email }; return }
     await sleep(400)
   }
   throw new Error(`createHuman(${ref}): identity row never provisioned`)
   ```

2. **Agents** — created *as their owner* (not admin), through the same product RPC a real user
   would hit, so triggers/guards fire identically. Each needs a device row first (presence
   depends on it).
3. **Friendships** — canonicalize the pair order before insert so the unique constraint holds.
4. **Groups** — created through the *product's own* group-creation RPC, then any side tables the
   RPC doesn't populate are filled explicitly, and any privileged role (e.g. a supervisor role
   guarded by a trigger) is set **as the group owner** because the guard only admits owner/admin.
5. **Presence** — seed each agent's runtime state (idle / running-in-a-chat) and beat a device
   **heartbeat**, because "online" is judged by a freshness window (a stale `last_seen_at` reads
   as offline).
6. **History** — backfill past messages. Convert each `agoMin` to a real `created_at` and insert
   in **strict ascending time order** (last-message triggers read `NEW.created_at`):

   ```js
   const hist = [...(play.history ?? [])].sort((x, y) => (y.agoMin ?? 0) - (x.agoMin ?? 0))
   for (const h of hist) {
     const createdAt = new Date(Date.now() - (h.agoMin ?? 0) * 60_000).toISOString()
     await insertMessage(state, { ...h, createdAt })
   }
   ```

7. **Read markers** — mark the hero conversation's backfilled history as *read* so it doesn't
   open the take already wearing an unread badge.

### perform — the timed live take

`t0 = process start`. Steps carry `atMs` (offset from t0); the harness sleeps to each step's
time and applies it, so events land on the recording UI over realtime with the exact cadence
the shot wants.

```js
async function perform(play, state, section) {
  const t0 = Date.now()
  const steps = [...(play.timeline ?? [])]
    .filter((s) => (section ? s.section === section : !s.section))
    .sort((a, b) => a.atMs - b.atMs)
  if (!steps.length) throw new Error(`perform: no steps${section ? ` for "${section}"` : ''}`)
  for (const step of steps) {
    const wait = t0 + step.atMs - Date.now()
    if (wait > 0) await sleep(wait)
    if (step.op === 'message')            await insertMessage(state, step)
    else if (step.op === 'agent-activity') await setAgentActivity(state, step)
    else if (step.op === 'mark-read')      await markRead(state, step)
    else if (step.op === 'heartbeat')      await heartbeat(state)
    else if (step.op === 'row')            await insertRow(state, step)
    else throw new Error(`unknown timeline op: ${step.op}`)
  }
}
```

**`--section` interleaves real human typing.** The recording operator types a real message in
the UI; you split the timeline into sections `a`/`b`/`c` and fire each section after the
corresponding human beat, so orchestrated agent replies land *between* the human's own actions
instead of racing them. `t0` is the section's launch moment — the convention is to spawn a
section's `perform` the instant the human's message is sent.

### teardown — leave zero residue

**You share the database with production.** Teardown deletes exactly what the run created, in
**reverse dependency order**, then verifies zero residue and throws if any remains:

- Delete child/derived rows before parents (message deliveries → messages → group side-tables →
  the group, then members). Order matters against invariant triggers — e.g. a "group must have
  exactly one owner" trigger means you must delete the group row *before* its members, not after.
- Delete agents through the product's owner-scoped removal RPC (device FKs are `RESTRICT` and
  only the proper path unwinds them), then delete the human auth users.
- Some deletes don't cascade (observed: deleting an auth user leaves identity/friendship rows) —
  clean those explicitly.
- **Verify**: re-query for the created IDs; if anything is left, throw.

  ```js
  const { data: left } = await identityAdmin.from('users').select('id').in('id', allIds)
  if (left?.length) throw new Error(`teardown: ${left.length} rows still present`)
  process.stdout.write('[teardown] verified zero residue\n')
  ```

Reshooting? Just mint fresh — a new `runId` namespaces the new run's accounts and IDs.

---

## The `screenplay.json` schema

One file per shot. Refs (`director`, `main`, `wenxian`, …) are your handles; the harness resolves
them to real IDs at write time.

```jsonc
{
  "cast": {
    "director": { "kind": "human", "name": "…" },
    "wenxian":  { "kind": "agent", "name": "…", "avatar": "…", "owner": "director" }
  },
  "friendships": [ ["director", "shijie"] ],            // pairs of human refs
  "groups": {
    "main": {
      "creator": "director",
      "name": "…",
      "members": ["shijie", "wenxian", "shiyan"],       // human + agent refs
      "agentRoles": { "shiyan": "supervisor" }          // privileged role, set as owner
    }
  },
  "presence": { "wenxian": "idle", "shiyan": "running:main" },  // "activity" or "activity:group"
  "history": [
    { "group": "main", "from": "shijie", "agoMin": 1603, "text": "…" }
  ],
  "timeline": [
    { "atMs": 200,   "op": "heartbeat" },
    { "atMs": 1400,  "op": "agent-activity", "who": "wenxian", "activity": "running",
      "group": "main", "actions": ["search"] },
    { "atMs": 3200,  "op": "message", "group": "main", "from": "wenxian", "text": "…",
      "mentions": ["director"] },
    { "section": "c", "atMs": 900, "op": "row", "schema": "chat", "table": "workspace_items",
      "row": { "id": "{{uuid}}", "chat_id": "{{group.main}}",
               "created_by": "{{cast.wenxian}}", "inline_text": "…" } }
  ]
}
```

### Timeline op types

| op | fields | effect |
|---|---|---|
| `message` | `group`, `from`, `text`, `mentions?`, `createdAt?` | insert a chat message (realtime → UI) |
| `agent-activity` | `who`, `activity` (`running`/`idle`), `group?`, `actions?` | flip an agent's presence/activity; `actions` maps to the "running" verb shown |
| `mark-read` | `group`, `who`, `upToSeq?` | advance a read marker (clears/keeps unread badges); defaults to latest seq |
| `heartbeat` | — | refresh device freshness so presence doesn't decay to offline mid-take |
| `row` | `schema`, `table`, `row`, `onConflict?` | insert/upsert an arbitrary backend row — the generic escape hatch for any "artifact" surface (documents, tasks, outputs) |

### Template resolution

Inside a `row` op, string values are resolved just before the write:

```js
if (value === '{{uuid}}') return randomUUID()
return value
  .replaceAll('{{now}}', nowIso())
  .replace(/\{\{cast\.(\w+)\}\}/g,  (_, ref) => resolveUser(ref, state))   // → real user/agent id
  .replace(/\{\{group\.(\w+)\}\}/g, (_, ref) => state.groups[ref].chatId)  // → real chat id
```

- `{{uuid}}` → a fresh UUID
- `{{now}}` → current ISO timestamp
- `{{cast.<ref>}}` → the real ID of a human or agent
- `{{group.<ref>}}` → the real ID of a group

Arrays and nested objects are resolved recursively, so a whole `row` payload can be authored in
refs and templates and comes out fully wired to real IDs.

### `state.json` (prepare's output)

```jsonc
{
  "runId": "a1b2c3",                                     // namespaces this run's accounts
  "humans": { "director": { "userId": "…", "email": "…" } },
  "agents": { "wenxian": { "id": "…", "ownerRef": "director", "deviceId": "…" } },
  "groups": { "main": { "chatId": "…", "creatorRef": "director" } }
}
```

This is the ledger teardown replays in reverse. Keep it for the life of the run; it *is* the
list of what to delete.

---

## The one adapter: writes are yours to implement

**This is the only product-specific part.** The phase model (prepare → perform → teardown), the
`screenplay.json` schema, the timeline ops, template resolution, and the reverse-order-teardown
discipline are all reusable as-is. What is *not* reusable is the body of each op — the actual
backend writes.

In the reference harness, `insertMessage`, `createAgent`, `createGroup`, `setAgentActivity`,
`markRead`, `insertRow`, `teardown` all write against one specific backend's tables and RPCs. For
your product, you re-implement those bodies against *your* backend — same op names, same
screenplay contract, different SQL/RPC/API calls underneath. The rule of thumb: **drive writes
through the same path a real client or its test back door would use**, so the same triggers,
broadcasts, and guards fire — that is what makes the orchestrated state indistinguishable from
organically-created state on the recording UI.

Two properties every adapter must keep:

- **Realtime must actually reach the recording UI.** The whole point of `perform` is that a DB
  write animates on screen. If your writes don't fan out over your realtime channel to a
  subscribed client, orchestration buys you nothing live — verify a write shows up on the UI.
- **Fail loud, everywhere.** Every op in the reference throws on the first error and never
  silently falls back. A half-applied prepare or a partial teardown on a shared DB is worse than
  a loud stop.

### Credentials: env only, admin/service-role, never hardcoded

The harness writes with **admin (service-role) credentials** — it has to, to mint accounts and
seed arbitrary state. Those credentials are read from the environment and the run **throws if
they're missing**:

```js
const URL_    = process.env.SUPABASE_URL ?? process.env.…
const ANON    = process.env.…_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !ANON || !SERVICE) throw new Error('need URL + ANON_KEY + SERVICE_ROLE_KEY (env)')
```

(A small `.env.local` loader fills `process.env` if a gitignored env file is present, but the
values still originate as environment configuration, never literals in the script.)

Hard lines:

- The service-role/admin key is a **secret**. Never hardcode it, never commit it, never paste it
  into an issue/PR/chat. Env or a gitignored env file only.
- Backend URLs, keys, host names, and SSH details are **your machine's** to configure. Nothing in
  the phase model or schema depends on any particular one; keep them out of anything shared.
- Because you write with admin rights against a shared database, **teardown is not optional** —
  the "verify zero residue" step is the safety interlock, not decoration.
