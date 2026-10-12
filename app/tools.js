// 片场's tools for agents (guide apps-programs): every export is one tool, `agent` is stamped by gugu — never asked for.
// The card table is the file the agent was woken about; what to do with it is the studio skill (skills/studio).
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_SECONDS, checkClip, ffmpegTools, makeCover, makeStrip, refusalOf } from './clip.js'
import { costOf, layNarration, linesOf, overrunMessage, overruns, secondsOf, speak, voiceOf } from './voice.js'
import { KINDS, addRound, answered, feedbackOf, limitsOf, normalizeTable, picksSoFar, roundCall, roundsInOrder, slotOf, statusOf, waitingRound, workingCopyPath } from './model.js'
import { IMAGE_MODEL, SETTINGS_FILE, VOICES, VOICE_MODEL, parseSettings } from './settings.js'

const BOARD = { type: 'string', format: 'gugu-file', description: 'The card table: the .studio.json file the whisper you got is about.' }
const now = () => new Date().toISOString()
const newId = (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}`
const short = (text, n = 280) => (text && text.length > n ? `${text.slice(0, n)}…` : text ?? '')

async function openBoard(board) {
  const f = await gugu.files.open({ id: board })
  // The same once-only fill the page does (model.js normalizeTable): a table from before 0.3.0 gets its lines, whoever
  // opens it first.
  if (normalizeTable(structuredClone(f.toJSON()))) f.transact(() => normalizeTable(f.data))
  return f
}

/** Written through before the call answers: an agent that reads the table next must find its own card there. */
function flushed(f) {
  if (f.saved) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the card table did not save within 10 s — try again')), 10_000)
    f.onStatus(() => {
      if (f.saved) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

/** A clip handed in with `video`: its original stays in the agent's working copy; the card keeps where, its size and hash. */
const VIDEO = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'The review render (720p, at most 25 MB) in your working copy, relative to it (renders/cut.720p.mp4). It stays there — the card keeps where it is, not a copy.' },
  },
  description: 'A clip whose original stays on your machine. submit reads it here: checks it (a clip nobody can hear is refused), makes its cover and its strip of frames and puts those two in the chat. Instead of putting the clip itself in files.',
}

/** The largest file an App can open (gugu's open-file limit): a bigger original could be kept but never played. */
const PLAYABLE_BYTES = 25 * 1024 * 1024

/**
 * A file the agent names in its working copy (gugu stamps which session and which working copy — never its word): its
 * path there, where it really is, and its size. Nothing outside the working copy, however it is reached.
 */
function workingCopyRoot({ session, workspaceRoot }) {
  if (!session || !workspaceRoot) {
    throw new Error('this gugu does not tell the tool which session you are in: hand the clip in as a file instead (put it in the chat\'s group folder, then give its item id in files)')
  }
  return realpathSync(workspaceRoot)
}
function inWorkingCopy(given, stamp, what) {
  const root = workingCopyRoot(stamp)
  const rel = workingCopyPath(given)
  if (!rel) throw new Error(`${what} is a path inside your working copy, like renders/cut.mp4 — not ${JSON.stringify(given)}`)
  let abs
  try {
    abs = realpathSync(path.join(root, rel))
  } catch {
    throw new Error(`no file ${rel} in your working copy`)
  }
  const inside = path.relative(root, abs)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`${rel} leads outside your working copy`)
  const stat = statSync(abs)
  if (!stat.isFile()) throw new Error(`${rel} is not a file`)
  return { rel, abs, root, stat }
}

/** The original of a clip, read where the agent works. */
async function originalOf(video, { session, workspaceRoot }) {
  const { rel, abs, stat } = inWorkingCopy(video.path, { session, workspaceRoot }, 'video.path')
  if (stat.size > PLAYABLE_BYTES) {
    throw new Error(`${rel} is ${(stat.size / 1024 / 1024).toFixed(1)} MB; the table plays an original of up to 25 MB — hand in the 720p review render instead and keep the master where you rendered it`)
  }
  const sha256 = await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(abs).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
  })
  // Read here, where it was made: the check first (a clip nobody can hear is refused before anything is written),
  // then its cover and strip, made into a folder of their own for submit to put in the chat.
  const tools = ffmpegTools()
  let check
  try {
    check = await checkClip(abs, tools)
  } catch (error) {
    throw new Error(`${rel} was not handed in: ${error.message}`)
  }
  const refusal = refusalOf(check)
  if (refusal) throw new Error(`${rel} was not handed in: ${refusal}`)
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-clip-'))
  // Named by the clip and the first characters of its hash: two cards' film.mp4 are two names in the group folder.
  const name = `${path.basename(rel, path.extname(rel))}-${sha256.slice(0, 8)}`
  const round = (n) => Math.round(n * 100) / 100
  let pictures
  try {
    pictures = {
      dir,
      cover: await makeCover(abs, path.join(dir, `${name}-cover.jpg`), check.seconds, tools),
      strip: await makeStrip(abs, path.join(dir, `${name}-strip.jpg`), check.seconds, tools),
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`${rel} was not handed in: ${error.message}`)
  }
  return {
    pictures,
    video: {
      seconds: round(check.seconds),
      width: check.width,
      height: check.height,
      bytes: stat.size,
      sha256,
      at: { session, path: rel },
      check: { lufs: check.lufs, peak: check.peak, silence: check.silence, black: check.black.map((s) => s.map(round)), white: check.white.map((s) => s.map(round)) },
    },
  }
}

/** The cover and the strip of a clip, put in the table's chat: their item ids, for the card. */
async function picturesIn(chat, { cover, strip }) {
  const file = (p) => new File([readFileSync(p)], path.basename(p), { type: 'image/jpeg' })
  const entries = await gugu.files.upload({ chat }, [file(cover), file(strip)])
  const [coverId, stripId] = entries.map((entry) => entry.id)
  if (!coverId || !stripId) throw new Error('the cover and strip did not reach the chat — try again')
  return { cover: coverId, strip: stripId }
}

/** A sound handed in with `audio` (a voice sample, a narration): read where it was made — refused when nobody can hear it. */
async function soundOf(audio, stamp) {
  const { rel, abs, stat } = inWorkingCopy(audio.path, stamp, 'audio.path')
  if (stat.size > PLAYABLE_BYTES) throw new Error(`${rel} is ${(stat.size / 1024 / 1024).toFixed(1)} MB; the table plays a sound of up to 25 MB`)
  // A sound has no picture to ask for: only whether anyone can hear it.
  const refusal = refusalOf({ ...(await checkClip(abs, ffmpegTools())), hasPicture: true })
  if (refusal) throw new Error(`${rel} was not handed in: ${refusal}`)
  const ext = path.extname(rel).toLowerCase()
  const type = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg' }[ext]
  if (!type) throw new Error(`${rel}: a sound is an mp3, m4a, wav, aac or ogg file`)
  // Named as the cover is: by the file and the first characters of its hash — every card's eve.mp3 is its own name.
  const sha8 = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 8)
  return { abs, rel, type, name: `${path.basename(rel, path.extname(rel))}-${sha8}${ext}` }
}

/** What one of the App's tools paid the person's media service, added to the table's total (cards[] keep the agent's own report). */
async function recordSpend(board, entry) {
  const f = await openBoard(board)
  try {
    f.data.spend[newId('s')] = { ...entry, at: now() }
    await flushed(f)
  } finally {
    f.close()
  }
}

/** How long a call waits for the service to price what it bought (its record comes ~12 s later); tests shorten it. */
export const PRICING = { wait: 20_000, catchUp: 8_000 }

/**
 * Purchases an earlier call could not price in time: asked again (one short deadline for all), and the table's total
 * corrected for those priced now. Done on the next voice or image call; what is still unpriced stays for the next one.
 */
async function catchUpSpend(board, key) {
  const f = await openBoard(board)
  try {
    const owed = Object.values(f.data.spend ?? {}).filter((entry) => entry.pending?.length)
    if (!owed.length) return
    const deadline = Date.now() + PRICING.catchUp
    const prices = new Map(await Promise.all(owed.flatMap((entry) => entry.pending).map(async (generation) => [generation, await costOf(key, generation, { deadline })])))
    let changed = false
    for (const entry of owed) {
      const found = entry.pending.filter((generation) => typeof prices.get(generation) === 'number')
      if (!found.length) continue
      changed = true
      entry.usd = (entry.usd ?? 0) + found.reduce((sum, generation) => sum + prices.get(generation), 0)
      const left = entry.pending.filter((generation) => !found.includes(generation))
      if (left.length) {
        entry.pending = left
        entry.unpriced = left.length
      } else {
        delete entry.pending
        delete entry.unpriced
      }
    }
    if (changed) await flushed(f)
  } finally {
    f.close()
  }
}

const cardLine = (data, id, card) => ({
  id,
  round: data.rounds[card.round]?.n ?? null,
  slot: slotOf(data, card),
  kind: card.kind,
  title: card.title,
  by: card.by,
  model: card.model ?? null,
  version: card.version ?? 1,
  // The earlier versions kept, by number (a new version keeps the one it replaces).
  earlierVersions: Object.keys(card.versions ?? {}).map(Number).sort((a, b) => a - b),
  status: statusOf(data, id).label,
  // What people (and the agents they asked) already said about it, the latest few: read before you annotate it too.
  notes: feedbackOf(data, id).filter((entry) => entry.verdict === 'note').slice(-5).map((entry) => ({ who: entry.who, comment: entry.comment, at: entry.ts })),
  files: card.files ?? [],
  ...(card.video ? { video: { cover: card.video.cover, strip: card.video.strip, seconds: card.video.seconds, at: card.video.at } } : {}),
  parents: card.parents ?? [],
})

export const board = {
  description:
    'Read a Studio (片场) card table: the brief, the rounds that ask you for cards, the rules added on this table, every card with its status and notes, and the feedback on your own cards (answer a reject with a new version of that card). Call it first whenever you are woken about a card table or asked to look at its cards.',
  inputSchema: { type: 'object', required: ['board'], properties: { board: BOARD } },
  annotations: { readOnlyHint: true },
  async run({ board: id }, { agent }) {
    const f = await openBoard(id)
    try {
      const data = f.toJSON()
      const cards = Object.entries(data.cards)
      const mine = cards.filter(([, card]) => card.by === agent)
      const rounds = roundsInOrder(data)
      return {
        brief: String(data.brief ?? ''),
        you: agent,
        // Who leads (opens the rounds with open_round), what it plans next, and what it waits for.
        lead: { agent: data.lead ?? null, isYou: Boolean(data.lead) && data.lead === agent, plan: data.plan ?? [], pausedByPerson: Boolean(data.paused), waitingFor: waitingRound(data), limits: limitsOf(data) },
        rules: {
          codex: 'skills/promo-video/references/director-rulings.md (rules 1–23) — read it before you hand in or annotate a card',
          added: Object.values(data.rules).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')).map((rule, i) => `${24 + i}. ${rule.text}`),
        },
        askedOfYou: rounds
          .filter(([, r]) => (r.agents ?? []).includes(agent))
          .map(([rid, r]) => ({
            round: rid,
            n: r.n,
            kind: r.kind,
            slot: r.slot,
            track: r.track,
            ask: r.ask || '(nothing more than the brief and the picked cards)',
            each: r.each,
            handedIn: mine.filter(([, card]) => card.round === rid).length,
            refs: (r.refs ?? []).filter((cid) => data.cards[cid]).map((cid) => ({ id: cid, title: data.cards[cid].title, text: short(data.cards[cid].text, 1200), files: data.cards[cid].files ?? [] })),
            otherAgents: (r.agents ?? []).filter((a) => a !== agent),
          })),
        feedbackOnYours: mine.flatMap(([cid, card]) =>
          feedbackOf(data, cid)
            .filter((entry) => entry.verdict !== 'pick')
            .map((entry) => ({ card: cid, title: card.title, verdict: entry.verdict, comment: entry.comment, at: entry.ts, answered: answered(data, cid, entry) })),
        ),
        cards: cards.map(([cid, card]) => ({ ...cardLine(data, cid, card), text: short(card.text) })),
      }
    } finally {
      f.close()
    }
  },
}

export const submit = {
  description:
    'Hand in one card for a round of a Studio (片场) card table — or a new version of one of your own cards (pass `card`; that is how a reject is answered). A card is a title plus text (markdown) and/or files you put in the same chat\'s group folder first (give their item ids), and/or a clip (`video`: just its path in your working copy — submit checks it and makes its cover and strip), or a sound (`audio`: a voice sample from the `voice` tool — one per card). Report what it cost: media dollars as the image/video API reported them, wall seconds, your approximate tokens. One call per card.',
  inputSchema: {
    type: 'object',
    required: ['board', 'round'],
    properties: {
      board: BOARD,
      round: { type: 'string', description: 'The round id, from board → askedOfYou.' },
      title: { type: 'string', description: 'A few words the person can pick by. A new version keeps the old title (and text, files) unless you give them again.' },
      text: { type: 'string', description: 'The card itself in markdown: the narrative, the copy, the shot description, what a clip shows.' },
      files: { type: 'array', items: { type: 'string' }, description: 'Item ids of files in this chat (images, clips, audio) that are this card.' },
      video: VIDEO,
      audio: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string', description: 'A sound in your working copy, relative to it: an mp3 the `voice` tool made (a voice sample), or another. submit checks it can be heard and puts it in the chat; the card plays it.' } },
        description: 'A sound that is the card (one voice sample per card) — instead of uploading it yourself.',
      },
      card: { type: 'string', description: 'Your own card to revise (a new version of it). Someone else\'s card: pass it in parents instead.' },
      parents: { type: 'array', items: { type: 'string' }, description: 'Cards this one mixes or builds on.' },
      model: { type: 'string', description: 'The model you are (shown on the card).' },
      cost: {
        type: 'object',
        properties: { usd: { type: 'number' }, seconds: { type: 'number' }, tokens: { type: 'number' } },
        description: 'usd: media APIs only (their own usage.cost); seconds: wall time this card took; tokens: your own, approximate.',
      },
    },
  },
  async run(args, { agent, session, workspaceRoot }) {
    if (!agent) throw new Error('submit is for agents (gugu stamps who calls)')
    // Read before the table is opened: a clip that is not there, or that nobody can hear, is said before anything is written.
    const clip = args.video ? await originalOf(args.video, { session, workspaceRoot }) : null
    const sound = args.audio ? await soundOf(args.audio, { session, workspaceRoot }) : null
    // A clip already on the card, as plain values (the table's own objects are live).
    const plainVideo = (v) => (v ? JSON.parse(JSON.stringify(v)) : null)
    let f = null
    try {
      f = await openBoard(args.board)
      const round = f.data.rounds[args.round]
      if (!round) throw new Error(`no round ${args.round} on this table — see board → askedOfYou`)
      const own = args.card && f.data.cards[args.card]?.by === agent ? args.card : null
      // A new version keeps what it does not say again (a revision that only redraws keeps its title and text).
      const prev = own ? f.data.cards[own] : {}
      const title = String(args.title ?? prev.title ?? '')
      const text = String(args.text ?? prev.text ?? '')
      // A new sound replaces the card's files, unless files are given with it.
      const files = (args.files ?? (sound ? [] : prev.files) ?? []).map(String)
      if (!title) throw new Error('a card needs a title')
      if (!text && !files.length && !clip && !sound && !prev.video) throw new Error('a card needs text, files, a video or a sound')
      // The last thing before the card is written: nothing reaches the chat for a card that is refused.
      const video = clip ? { ...(await picturesIn(f.entry.chat, clip.pictures)), ...clip.video } : null
      if (sound) {
        const [entry] = await gugu.files.upload({ chat: f.entry.chat }, [new File([readFileSync(sound.abs)], sound.name, { type: sound.type })])
        if (!entry?.id) throw new Error('the sound did not reach the chat — try again')
        files.push(entry.id)
      }
      const at = now()
      const fields = {
        title,
        text,
        files,
        model: args.model ? String(args.model) : prev.model ?? null,
        cost: { usd: Number(args.cost?.usd) || 0, seconds: Number(args.cost?.seconds) || 0, tokens: Number(args.cost?.tokens) || 0 },
        ...((video ?? prev.video) ? { video: video ?? plainVideo(prev.video) } : {}),
      }
      let id
      if (own) {
        id = own
        const card = f.data.cards[id]
        // The version this one replaces is kept as it was: the history compares them.
        const replaced = card.version ?? 1
        const versions = { ...(card.versions ?? {}), [replaced]: { title: card.title, text: card.text ?? '', files: card.files ?? [], ...(card.video ? { video: plainVideo(card.video) } : {}), model: card.model ?? null, cost: card.cost ?? {}, at: card.updatedAt ?? card.at } }
        f.data.cards[id] = { ...fields, round: card.round, slot: card.slot, kind: card.kind, by: agent, parents: card.parents ?? [], version: replaced + 1, versions, at: card.at, updatedAt: at }
      } else {
        id = newId('c')
        const parents = [...new Set([...(args.parents ?? []), ...(args.card ? [args.card] : [])])].filter((cid) => f.data.cards[cid])
        f.data.cards[id] = { ...fields, round: args.round, slot: round.slot, kind: round.kind, by: agent, parents, version: 1, at, updatedAt: at }
      }
      await flushed(f)
      return { card: id, version: f.data.cards[id].version, revised: Boolean(own), ...(video ? { check: video.check } : {}) }
    } finally {
      f?.close()
      // The cover and strip were made for this call only: in the chat now, or not wanted.
      if (clip) rmSync(clip.pictures.dir, { recursive: true, force: true })
    }
  },
}

export const note = {
  description:
    'Annotate one card of a Studio (片场) card table, as a person in the chat would with 批注: one or two lines on what works and what to change, citing a rule when one applies (§n of director-rulings.md, or a rule added on the table). It wakes nobody: the author reads it on the table. Use it when someone asks you to look at the cards; the person picks and rejects, you only say what you see. One call per card.',
  inputSchema: {
    type: 'object',
    required: ['board', 'card', 'comment'],
    properties: {
      board: BOARD,
      card: { type: 'string' },
      comment: { type: 'string', description: 'What works, what to change; the rule (§n) when one applies. No score.' },
    },
  },
  async run({ board: id, card, comment }, { agent }) {
    if (!agent) throw new Error('note is for agents (gugu stamps who calls)')
    if (!String(comment ?? '').trim()) throw new Error('a note needs a comment')
    const f = await openBoard(id)
    try {
      const target = f.data.cards[card]
      if (!target) throw new Error(`no card ${card} on this table`)
      f.data.feedback[newId('f')] = { card, verdict: 'note', comment: String(comment).trim(), who: agent, ts: now() }
      await flushed(f)
      // Nobody is woken, as by a person's 批注: a note asks nothing of the author, who reads it on the next board.
      return { card, noted: true }
    } finally {
      f.close()
    }
  },
}

const DATA_DIR = process.env.GUGU_EXTENSION_DATA_DIR ?? path.join(process.cwd(), '.data')
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
const readSettings = () => {
  try {
    return parseSettings(readFileSync(path.join(DATA_DIR, SETTINGS_FILE), 'utf8'))
  } catch {
    return {}
  }
}
const keyOf = (settings) => (typeof settings.openrouterKey === 'string' ? settings.openrouterKey.trim() : '')

/** The settings box's 「保存并检查」: OpenRouter's key endpoint answers without making (or charging for) an image. */
export const check_image_key = {
  description: 'Check the OpenRouter key in Studio\'s settings (the card table\'s settings box only).',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  _meta: { ui: { visibility: ['app'] } },
  async run() {
    const settings = path.join(DATA_DIR, SETTINGS_FILE)
    const key = keyOf(readSettings())
    if (!key) return { ok: false, reason: '还没有密钥', settings }
    const headers = { Authorization: `Bearer ${key}` }
    const res = await fetch('https://openrouter.ai/api/v1/key', { headers })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, reason: `OpenRouter 说 HTTP ${res.status}${json.error?.message ? `：${json.error.message}` : ''}`, settings }
    // What can be spent is the smaller of the key's own limit and the account's credits (an empty account answers 402).
    const credits = await fetch('https://openrouter.ai/api/v1/credits', { headers }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const left = [json.data?.limit_remaining, credits?.data ? credits.data.total_credits - credits.data.total_usage : undefined].filter((n) => typeof n === 'number')
    return { ok: true, remaining: left.length ? Math.min(...left) : null, settings }
  },
}

export const image = {
  description:
    'Make one image for a Studio (片场) card — a storyboard frame, a poster, a key visual — with the image model the person set up in the card table (OpenRouter, their key). Answers a local file path: put it in the chat\'s group folder (as image/png), then give its item id in submit → files, and its cost in submit → cost.usd. What it paid is added to the table\'s total. Use it whichever harness you are; a harness with its own image tool may use that instead.',
  inputSchema: {
    type: 'object',
    required: ['board', 'prompt'],
    properties: {
      board: BOARD,
      prompt: { type: 'string', description: 'The picture, in words: subject, composition, style, what must be on screen. No text in the image unless you ask for it.' },
      aspect: { type: 'string', enum: ['16:9', '1:1', '9:16', '4:3', '3:4'], description: 'Default 16:9 (a frame of the film).' },
      references: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of images on this computer to keep the look of (a mascot, a product screenshot).' },
    },
  },
  async run({ board, prompt, aspect = '16:9', references = [] }, { agent }) {
    const settings = readSettings()
    const key = keyOf(settings)
    if (!key) throw new Error('No image key yet: the person adds their OpenRouter key under 「出图设置」 on the card table. Until then hand in a precise frame description and say so.')
    const ref = (file) => {
      const mime = MIME[path.extname(file).toLowerCase()]
      if (!mime) throw new Error(`reference ${file}: only png, jpg or webp`)
      return { type: 'image_url', image_url: { url: `data:${mime};base64,${readFileSync(file).toString('base64')}` } }
    }
    const started = Date.now()
    const res = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(240_000), // under Claude's 300 s tool limit: a clear error, not an abort
      body: JSON.stringify({
        model: settings.imageModel || IMAGE_MODEL,
        prompt: String(prompt),
        aspect_ratio: aspect,
        quality: 'high',
        n: 1,
        ...(references.length ? { input_references: references.map(String).map(ref) } : {}),
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.data?.[0]?.b64_json) {
      const why = res.status === 402 ? 'the person\'s OpenRouter account is out of credits' : `the image service said HTTP ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`
      throw new Error(`No image: ${why}. Hand in a precise frame description for now and say so in the card — never draw the frame with a script instead.`)
    }
    const dir = path.join(DATA_DIR, 'images')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${agent ? agent.slice(5, 13) : 'page'}.png`)
    writeFileSync(file, Buffer.from(json.data[0].b64_json, 'base64'))
    // A key that brings its own provider key (BYOK) is charged upstream: OpenRouter's own cost then reads 0.
    const usage = json.usage ?? {}
    const usd = Number(usage.cost) || Number(usage.cost_details?.upstream_inference_cost) || 0
    await recordSpend(board, { tool: 'image', usd, by: agent ?? null, what: String(prompt).slice(0, 80) })
    await catchUpSpend(board, key).catch(() => {})
    return {
      file_path: file,
      model: settings.imageModel || IMAGE_MODEL,
      seconds: Math.round((Date.now() - started) / 1000),
      usd,
      next: 'put this file_path in the chat\'s group folder (as image/png), then pass its item id in submit → files',
    }
  },
}

export const voice = {
  description:
    'Voice a film\'s narration, or voice samples to pick a voice from, with the voice model the person set up on the card table (OpenRouter, their key). A film: give the film in your working copy and its lines, each with the second it starts at; every line is spoken, laid at its start on one track at -16 LUFS over the film\'s own sound — kept, and lowered under each spoken line; a silent film gets the narration alone (the picture is not touched) → renders/<film>.voiced.mp4 next to it, which you hand in with submit → video. A line that runs into the next one is refused, saying by how much and about how many characters fit; a line already spoken the same way is not paid for again. Samples: give one line and several voices → one mp3 per voice; hand each in as its own card with submit → audio. What it paid is added to the table\'s total.',
  inputSchema: {
    type: 'object',
    required: ['board'],
    properties: {
      board: BOARD,
      film: { type: 'string', description: 'The film in your working copy, relative to it (renders/cut.720p.mp4).' },
      lines: {
        type: 'array',
        items: { type: 'object', required: ['text', 'at'], properties: { text: { type: 'string' }, at: { type: 'number', description: 'The second it starts.' } } },
        description: 'The narration, in the order it is spoken.',
      },
      voice: { type: 'string', enum: VOICES, description: 'Default: the voice picked on the table\'s settings, else eve.' },
      sample: { type: 'string', description: 'Instead of a film: one line to say in each of `voices`.' },
      voices: { type: 'array', items: { type: 'string', enum: VOICES }, description: 'The voices for `sample` (default: all).' },
    },
  },
  async run(args, { agent, session, workspaceRoot }) {
    const settings = readSettings()
    const key = keyOf(settings)
    if (!key) throw new Error('No voice key yet: the person adds their OpenRouter key in the card table\'s settings (the same key pictures use). Ask them in one line; there is no placeholder voice.')
    const model = settings.voiceModel || VOICE_MODEL
    const cacheDir = path.join(DATA_DIR, 'voice')
    // ffmpeg first: a line is checked to be a sound before it is kept, and nothing is bought without one.
    const tools = ffmpegTools()
    // What this call bought (a line from the cache costs nothing): priced all at once when the call ends — the service
    // keeps its record of a purchase some 12 s after it — and put on the table once, whatever happens.
    const generations = []
    const say = async (voiceName, text) => {
      const said = await speak({ key, model, voice: voiceName, text, cacheDir, tools })
      if (said.generation) generations.push(said.generation)
      return said.file
    }
    let settled = null
    const settle = async () => {
      if (settled) return settled
      // One deadline for all of them: priced in time, or counted as not priced yet — the answer comes either way. What
      // earlier calls left unpriced is asked again meanwhile.
      const deadline = Date.now() + PRICING.wait
      const [prices] = await Promise.all([
        Promise.all(generations.map((generation) => costOf(key, generation, { deadline }))),
        catchUpSpend(args.board, key).catch(() => {}),
      ])
      const pending = generations.filter((_, i) => prices[i] === null)
      settled = { usd: prices.reduce((sum, n) => sum + (n ?? 0), 0), ...(pending.length ? { unpriced: pending.length } : {}) }
      if (prices.length) await recordSpend(args.board, { tool: 'voice', ...settled, ...(pending.length ? { pending } : {}), by: agent ?? null, what: `${prices.length} line(s) spoken` })
      return settled
    }
    try {
      if (args.sample !== undefined) {
        const text = String(args.sample).trim()
        if (!text) throw new Error('sample: the line to say in each voice')
        const root = workingCopyRoot({ session, workspaceRoot })
        const dir = path.join(root, 'renders', 'voice-samples')
        mkdirSync(dir, { recursive: true })
        const samples = []
        for (const name of args.voices?.length ? args.voices.map((v) => voiceOf(settings, v)) : VOICES) {
          const out = path.join(dir, `${name}.mp3`)
          writeFileSync(out, readFileSync(await say(name, text)))
          samples.push({ voice: name, path: path.relative(root, out).split(path.sep).join('/') })
        }
        return { samples, ...(await settle()), next: 'hand in each sample as its own card: submit → audio { path }, the voice in the title' }
      }
      const film = inWorkingCopy(args.film, { session, workspaceRoot }, 'film')
      const probe = await checkClip(film.abs, tools)
      if (!probe.hasPicture) throw new Error(`${film.rel} has no picture to voice`)
      if (probe.seconds > MAX_SECONDS) throw new Error(`${film.rel} is ${(probe.seconds / 60).toFixed(1)} minutes long; the table takes films of up to ${MAX_SECONDS / 60} minutes`)
      const filmSeconds = probe.seconds
      const lines = linesOf(args.lines, filmSeconds)
      const name = voiceOf(settings, args.voice)
      for (const line of lines) {
        const file = await say(name, line.text)
        Object.assign(line, { file, seconds: await secondsOf(tools, file) })
      }
      const problems = overruns(lines, filmSeconds)
      if (problems.length) throw new Error(`The narration does not fit the film: ${overrunMessage(problems)}. Lines already spoken are kept: a retry pays only for what changed.`)
      const out = path.join(path.dirname(film.abs), `${path.basename(film.rel, path.extname(film.rel))}.voiced.mp4`)
      // A film with a sound of its own keeps it, lowered under the narration; a silent one gets the narration alone.
      const original = probe.hasSound && probe.lufs !== null && probe.lufs > -60 ? { lufs: probe.lufs } : null
      await layNarration({ tools, film: film.abs, lines, seconds: filmSeconds, out, original })
      return {
        path: path.relative(film.root, out).split(path.sep).join('/'),
        voice: name,
        lines: lines.map((line, i) => ({ n: i + 1, at: line.at, seconds: Math.round(line.seconds * 100) / 100 })),
        ...(await settle()),
        next: 'hand it in with submit → video { path } (submit checks it and makes its cover and strip)',
      }
    } catch (error) {
      // A refusal after lines were bought: they are on the table all the same.
      await settle().catch(() => {})
      throw error
    }
  },
}

const ROUND = {
  type: 'object',
  required: ['kind', 'slot', 'agents'],
  properties: {
    kind: { type: 'string', enum: KINDS },
    slot: { type: 'string', description: 'What this round is for, in a few words (分镜 · 开头那 4 秒).' },
    ask: { type: 'string', description: 'What the writers are asked for, beyond the brief and the picks.' },
    agents: { type: 'array', items: { type: 'string' }, description: 'The writers (user:… of agents in this chat) — of different models where the chat has them.' },
    each: { type: 'number', description: 'Cards each writer hands in (default 1).' },
    track: { type: 'string', description: 'The line the round is a step of: 片子 or 文字 (default by the kind).' },
    refs: { type: 'array', items: { type: 'string' }, description: 'Cards to build on (default: every pick so far).' },
  },
}

export const open_round = {
  description:
    'Lead a Studio (片场) table: when the person asks the group for a film, plan its rounds and open them one at a time. The first call makes the table in this chat (give chat, title and brief, no board) and makes you its lead; every call opens one round — its writers are woken with what it asks — and may rewrite the plan of the rounds after it. A round opens only when every earlier one has a pick or was skipped: the person picks, and you are woken when they do. A table has at most 8 rounds and a round at most 4 writers unless the person set otherwise; while the person has taken the table over, nothing opens.',
  inputSchema: {
    type: 'object',
    required: ['round'],
    properties: {
      board: { ...BOARD, description: 'The table you lead. Leave it out on the first call: that call makes it.' },
      chat: { type: 'string', description: 'First call only: this group\'s chat id (the chat of the message that asked you).' },
      title: { type: 'string', description: 'First call only: the film\'s name — the table is named after it.' },
      brief: { type: 'string', description: 'First call only: what the person asked for, in a sentence or two.' },
      round: ROUND,
      plan: { type: 'array', items: { type: 'object', required: ['kind', 'slot'], properties: { kind: { type: 'string', enum: KINDS }, slot: { type: 'string' }, track: { type: 'string' } } }, description: 'The rounds you mean to open after this one, in order (replaces the plan on the table).' },
    },
  },
  async run(args, { agent }) {
    if (!agent) throw new Error('open_round is for agents (gugu stamps who calls)')
    const round = args.round ?? {}
    const kind = String(round.kind ?? '')
    if (!KINDS.includes(kind)) throw new Error(`round.kind: one of ${KINDS.join(', ')}`)
    const slot = String(round.slot ?? '').trim() || kind
    const agents = [...new Set((round.agents ?? []).map(String))]
    const each = Math.max(1, Math.round(Number(round.each) || 1))
    let board = args.board
    if (!board) {
      const chat = String(args.chat ?? '').trim()
      const title = String(args.title ?? '').trim()
      const brief = String(args.brief ?? '').trim()
      if (!chat || !title || !brief) throw new Error('the first call makes the table: give chat (this group\'s chat id), title (the film\'s name) and brief (what the person asked for) — or give board, the table you lead')
      const entry = await gugu.files.create({ chat, name: `${title.replace(/[\/:*?"<>|]/g, ' ').trim()}.studio.json` }, { brief: { $text: brief }, lead: agent, plan: [], rounds: {}, cards: {}, feedback: {}, rules: {}, names: {}, spend: {} })
      board = entry.id
    }
    const f = await openBoard(board)
    try {
      const data = f.data
      if (data.lead && data.lead !== agent) throw new Error('another agent leads this table: you are a writer here — board says what is asked of you')
      if (data.paused) throw new Error('the person has taken this table over: open nothing — you are told when it is handed back')
      const waiting = waitingRound(data)
      if (waiting) throw new Error(`round ${waiting.n} (${waiting.slot}) has no pick yet: the person picks, not you — you are woken when they do`)
      const limits = limitsOf(data)
      if (Object.keys(data.rounds).length >= limits.rounds) throw new Error(`this table has had its ${limits.rounds} rounds: ask the person in one line whether to go on (they can raise it in the table's settings)`)
      if (!agents.length) throw new Error('round.agents: the writers, as user:… of agents in this chat')
      if (agents.length > limits.writers) throw new Error(`round.agents: at most ${limits.writers} writers a round (you named ${agents.length})`)
      if (each > limits.each) throw new Error(`round.each: at most ${limits.each} cards each`)
      if (agents.includes(agent)) throw new Error('round.agents: not you — the lead plans and opens rounds; the writers hand in the cards')
      if (!data.lead) data.lead = agent
      if (args.plan) data.plan = args.plan.map((step) => ({ kind: String(step.kind), slot: String(step.slot ?? step.kind), ...(step.track ? { track: String(step.track) } : {}) }))
      const id = newId('r')
      const track = String(round.track ?? '').trim() || (kind === '宣传稿' || kind === '文案' ? '文字' : '片子')
      const n = addRound(data, { id, track, kind, slot, ask: String(round.ask ?? '').trim(), each, agents, refs: (round.refs ?? picksSoFar(data)).map(String) }, agent, now())
      // The step just opened leaves the plan.
      if (Array.isArray(data.plan) && data.plan[0]?.kind === kind) data.plan = data.plan.slice(1).map((step) => ({ ...step }))
      await flushed(f)
      const told = []
      const notTold = []
      for (const writer of agents) {
        try {
          await gugu.send(writer, roundCall({ n, slot, kind, each }), { about: f.entry })
          told.push(writer)
        } catch (error) {
          notTold.push({ writer, why: error.message })
        }
      }
      return { board, round: id, n, told, ...(notTold.length ? { notTold } : {}), plan: data.plan ?? [], next: 'wait: you are woken when the person picks from this round' }
    } finally {
      f.close()
    }
  },
}
