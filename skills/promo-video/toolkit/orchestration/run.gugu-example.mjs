#!/usr/bin/env node
// ┌───────────────────────────────────────────────────────────────────────────────────┐
// │ REFERENCE IMPLEMENTATION — this is the gugu (Supabase) orchestration adapter.        │
// │ It is the ONE product-specific piece of the pipeline. The REUSABLE parts are the     │
// │ phase model (prepare / perform / teardown) and the screenplay JSON schema (see       │
// │ screenplay.example.json and references/orchestration-harness.md). The actual DB      │
// │ writes below are gugu's — reimplement `phasePrepare/Perform/Teardown` against YOUR   │
// │ backend so your app's realtime layer pushes realistic live state to the recorded UI. │
// │ Credentials come from the ENVIRONMENT ONLY (fail loud if missing) — never hardcode.  │
// └───────────────────────────────────────────────────────────────────────────────────┘
// screenplay/run.mjs — 宣传片编排 harness：剧本 JSON → 定时 DB 写入（service-role），realtime 推到录制端 UI。
// 导演钦定拍法（h2 起）：agent 的消息/状态全部编排，不走产品真 agent 逻辑；录制端只演人类视角。
//
// 用法（在 gugu repo worktree 根目录跑，.env.local 提供 SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_*）：
//   node run.mjs <screenplay.json> --phase prepare  --state state.json   # 铸账号/建群/铺历史/预置状态
//   node run.mjs <screenplay.json> --phase perform  --state state.json   # 按 timeline 定时写库（t0=进程启动）
//   node run.mjs <screenplay.json> --phase teardown --state state.json   # 精确清零（共享库红线）
//
// 剧本 JSON 结构见同目录 *.json。所有写库走与 e2e 后门/产品同一通路：
//   · 消息 insert → chat.messages（trigger 补 seq + message_created broadcast，realtime 到达）
//   · 已读 → chat.chat_members.last_read_seq（trigger member_read_changed broadcast）
//   · agent 状态 → identity.agent_runtime_states（presence 订阅实时翻）
//   · 群内职责（督导等）→ chat.group_agent_states（须以群主身份改，guard trigger 校验）
// fail loud：任何一步失败直接 throw，不静默兜底。

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// ---------- env ----------
function loadDotEnvLocal() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const [, k, rawV] = m
      if (process.env[k] !== undefined) continue
      process.env[k] = rawV.replace(/^["']|["']$/g, '')
    }
  }
}
loadDotEnvLocal()

const URL_ = process.env.VITE_SUPABASE_URL ?? process.env.GUGU_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.GUGU_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !ANON || !SERVICE) throw new Error('need VITE_SUPABASE_URL/ANON_KEY + SUPABASE_SERVICE_ROLE_KEY (env or .env.local)')

const PASSWORD = 'GuguPromo-screenplay-pw'
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const identityAdmin = createClient(URL_, SERVICE, { db: { schema: 'identity' }, auth: { persistSession: false, autoRefreshToken: false } })
const chatAdmin = createClient(URL_, SERVICE, { db: { schema: 'chat' }, auth: { persistSession: false, autoRefreshToken: false } })

async function authed(email) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`authed(${email}): ${error.message}`)
  return c
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()

// ---------- prepare ops ----------
async function createHuman(ref, spec, state) {
  const email = `promo-${state.runId}-${ref}@${process.env.PROMO_EMAIL_DOMAIN ?? 'promo.example'}`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { nickname: spec.name, display_name: spec.name },
  })
  if (error) throw new Error(`createHuman(${ref}): ${error.message}`)
  const userId = data.user?.id
  if (!userId) throw new Error(`createHuman(${ref}): no user id`)
  // identity.users 行落库可能滞后（已知坑）——poll 到 display_name 写进为止
  for (let i = 0; i < 60; i++) {
    const { data: rows, error: e } = await identityAdmin.from('users').update({ display_name: spec.name }).eq('id', userId).select('id')
    if (e) throw new Error(`createHuman(${ref}).rename: ${e.message}`)
    if (rows?.length) { state.humans[ref] = { userId, email }; return }
    await sleep(400)
  }
  throw new Error(`createHuman(${ref}): identity.users row never provisioned`)
}

async function createAgent(ref, spec, state) {
  const owner = state.humans[spec.owner]
  if (!owner) throw new Error(`createAgent(${ref}): owner ${spec.owner} not prepared`)
  const client = await authed(owner.email)
  const deviceId = `promo-device-${owner.userId}`
  const { error: devErr } = await client.schema('identity').from('gugu_devices').upsert(
    { device_id: deviceId, user_id: owner.userId, label: 'promo', hostname: 'promo-host', platform: 'linux', status: 'online', last_seen_at: nowIso() },
    { onConflict: 'device_id', ignoreDuplicates: true },
  )
  if (devErr) throw new Error(`createAgent(${ref}).device: ${devErr.message}`)
  const { data, error } = await client.schema('identity').rpc('create_owned_agent', {
    p_display_name: spec.name,
    p_avatar: spec.avatar ?? './assets/agent-avatars/avatar-01.png',
    p_agent_type: spec.agentType ?? 'claude-code',
    p_device_id: deviceId,
  })
  if (error) throw new Error(`createAgent(${ref}): ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  const id = row?.id
  if (!id) throw new Error(`createAgent(${ref}): rpc returned no id`)
  state.agents[ref] = { id, ownerRef: spec.owner, deviceId }
  await client.auth.signOut({ scope: 'local' }).catch(() => {})
}

async function befriend(aRef, bRef, state) {
  const a = state.humans[aRef].userId, b = state.humans[bRef].userId
  const [ua, ub] = a < b ? [a, b] : [b, a]
  const { error } = await identityAdmin.from('friendships').upsert({ user_a_id: ua, user_b_id: ub }, { onConflict: 'user_a_id,user_b_id' })
  if (error) throw new Error(`befriend(${aRef},${bRef}): ${error.message}`)
}

function resolveUser(ref, state) {
  const u = state.humans[ref]?.userId ?? state.agents[ref]?.id
  if (!u) throw new Error(`unknown cast ref: ${ref}`)
  return u
}

async function createGroup(ref, spec, state) {
  const creator = state.humans[spec.creator]
  const client = await authed(creator.email)
  const chatId = randomUUID()
  // 产品同款 RPC（chat.ts:2268 createGroupChat 调的就是它）
  const { error } = await client.schema('chat').rpc('create_gugu_group', {
    p_chat_id: chatId,
    p_name: spec.name,
    p_owner_user_id: creator.userId,
    p_initial_members: spec.members.map((m) => ({ user_id: resolveUser(m, state), role: 'member' })),
    p_default_agent_type: null,
    p_group_prompt: null,
  })
  if (error) throw new Error(`createGroup(${ref}): ${error.message}`)
  state.groups[ref] = { chatId, creatorRef: spec.creator }
  // create_gugu_group 不铺 group_agent_states（collab 花名册/运行 token 条的数据源）——显式补行。
  const agentMembers = spec.members.filter((m) => state.agents[m])
  if (agentMembers.length) {
    const { error: gasErr } = await chatAdmin.from('group_agent_states').upsert(
      agentMembers.map((m) => ({
        chat_id: chatId,
        agent_user_id: resolveUser(m, state),
        functional_role: 'member',
        capability_roles: ['member'],
        last_action: '已加入群聊',
        updated_at: nowIso(),
      })),
      { onConflict: 'chat_id,agent_user_id' },
    )
    if (gasErr) throw new Error(`createGroup(${ref}).group_agent_states: ${gasErr.message}`)
  }
  // 群内职责（督导 supervisor 等）：guard trigger 只放行群主/管理员 → 必须用群主身份改
  for (const [m, role] of Object.entries(spec.agentRoles ?? {})) {
    const { data: rows, error: rErr } = await client
      .schema('chat')
      .from('group_agent_states')
      .update({ functional_role: role, capability_roles: [role] })
      .eq('chat_id', chatId)
      .eq('agent_user_id', resolveUser(m, state))
      .select('agent_user_id')
    if (rErr) throw new Error(`createGroup(${ref}).role(${m}=${role}): ${rErr.message}`)
    if (!rows?.length) throw new Error(`createGroup(${ref}).role(${m}): no group_agent_states row updated`)
  }
  await client.auth.signOut({ scope: 'local' }).catch(() => {})
}

let msgSerial = 0
async function insertMessage(state, { group, from, text, mentions, createdAt }) {
  const chatId = state.groups[group]?.chatId ?? group
  const body = {
    id: `promo-${state.runId}-${Date.now()}-${msgSerial++}`,
    chat_id: chatId,
    sender_user_id: resolveUser(from, state),
    content: text,
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(mentions?.length ? { to_user_ids: mentions.map((m) => resolveUser(m, state)) } : {}),
  }
  const { error } = await chatAdmin.from('messages').insert(body)
  if (error) throw new Error(`message(${from}→${group}): ${error.message}`)
}

// 运行 token 条的动词由 recent_actions 最新一项映射（agentRunningVerb.ts）：
// read→查阅中 / search|fetch→检索中 / edit→编辑中 / execute→执行中 / think→思考中 / 其他→运行中。
// 「运行中」只在 active_chat_id === 当前会话时显示（gateRunningStatusToChat），设备心跳须 <180s 新鲜。
async function setAgentActivity(state, { who, activity, group, actions }) {
  const agent = state.agents[who]
  if (!agent) throw new Error(`agent-activity: unknown agent ${who}`)
  const owner = state.humans[agent.ownerRef]
  const running = activity === 'running'
  const { error } = await identityAdmin.from('agent_runtime_states').upsert(
    {
      agent_user_id: agent.id,
      owner_user_id: owner.userId,
      runtime_status: 'online',
      activity_status: running ? 'running' : 'idle',
      active_chat_id: running && group ? (state.groups[group]?.chatId ?? group) : null,
      recent_actions: actions ?? (running ? ['execute'] : []),
      runtime_kind: 'acp',
      last_seen_at: nowIso(),
      last_action_at: nowIso(),
    },
    { onConflict: 'agent_user_id' },
  )
  if (error) throw new Error(`agent-activity(${who}=${activity}): ${error.message}`)
}

// 设备心跳：presence 的 deviceOnline 判据 = gugu_devices.status='online' 且 last_seen_at <180s。
async function heartbeat(state) {
  const deviceIds = [...new Set(Object.values(state.agents).map((a) => a.deviceId))]
  if (!deviceIds.length) return
  const { error } = await identityAdmin
    .from('gugu_devices')
    .update({ status: 'online', last_seen_at: nowIso() })
    .in('device_id', deviceIds)
  if (error) throw new Error(`heartbeat: ${error.message}`)
}

async function markRead(state, { group, who, upToSeq }) {
  const chatId = state.groups[group]?.chatId ?? group
  const seq = upToSeq ?? (await latestSeq(chatId))
  const { error } = await chatAdmin
    .from('chat_members')
    .update({ last_read_seq: seq })
    .eq('chat_id', chatId)
    .eq('user_id', resolveUser(who, state))
  if (error) throw new Error(`mark-read(${who}@${group}): ${error.message}`)
}

async function latestSeq(chatId) {
  const { data, error } = await chatAdmin.from('messages').select('seq').eq('chat_id', chatId).order('seq', { ascending: false }).limit(1)
  if (error) throw new Error(`latestSeq(${chatId}): ${error.message}`)
  return data?.[0]?.seq ?? 0
}

// ---------- phases ----------
async function prepare(play, state) {
  for (const [ref, spec] of Object.entries(play.cast)) {
    if (spec.kind === 'human') await createHuman(ref, spec, state)
  }
  for (const [ref, spec] of Object.entries(play.cast)) {
    if (spec.kind === 'agent') await createAgent(ref, spec, state)
  }
  for (const [a, b] of play.friendships ?? []) await befriend(a, b, state)
  for (const [ref, spec] of Object.entries(play.groups ?? {})) await createGroup(ref, spec, state)
  // presence 初值 + 设备心跳（deviceOnline 判据要求 <180s 新鲜）
  for (const [who, p] of Object.entries(play.presence ?? {})) {
    const [activity, group] = String(p).split(':')
    await setAgentActivity(state, { who, activity, group })
  }
  await heartbeat(state)
  // 历史消息：按 agoMin 换算 created_at，严格升序插入（update_chat_last_message 取 NEW.created_at）
  const hist = [...(play.history ?? [])].sort((x, y) => (y.agoMin ?? 0) - (x.agoMin ?? 0))
  for (const h of hist) {
    const createdAt = new Date(Date.now() - (h.agoMin ?? 0) * 60_000).toISOString()
    await insertMessage(state, { ...h, createdAt })
  }
  // 主群历史标记为「导师已读」，避免开拍时主群自己挂未读徽标
  for (const r of play.readAtPrepare ?? []) await markRead(state, r)
}

// 通用行注入：剧本里 "{{cast.xxx}}" / "{{group.yyy}}" / "{{now}}" 在写库前解析成真实 id/时间。
// 用于 group_tasks / group_outputs / workspace_items 这类「沉淀面」的编排 seed。
function resolveTemplates(value, state) {
  if (typeof value === 'string') {
    if (value === '{{uuid}}') return randomUUID()
    return value
      .replaceAll('{{now}}', nowIso())
      .replace(/\{\{cast\.([a-zA-Z0-9_]+)\}\}/g, (_, ref) => resolveUser(ref, state))
      .replace(/\{\{group\.([a-zA-Z0-9_]+)\}\}/g, (_, ref) => {
        const g = state.groups[ref]
        if (!g) throw new Error(`unknown group ref: ${ref}`)
        return g.chatId
      })
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, state))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTemplates(v, state)]))
  return value
}

async function insertRow(state, { schema, table, row, onConflict }) {
  const client = schema === 'identity' ? identityAdmin : chatAdmin
  const resolved = resolveTemplates(row, state)
  const q = onConflict ? client.from(table).upsert(resolved, { onConflict }) : client.from(table).insert(resolved)
  const { error } = await q
  if (error) throw new Error(`row(${schema}.${table}): ${error.message}`)
}

// --section <name>：只跑该 section 的条目（atMs 相对本次 perform 启动）。录制端真人打字
// 穿插在编排段之间时，把 timeline 切成 a/b/c 分段逐次触发。无 section 参数 = 跑全部无标段。
async function perform(play, state, section) {
  const t0 = Date.now()
  const steps = [...(play.timeline ?? [])]
    .filter((s) => (section ? s.section === section : !s.section))
    .sort((a, b) => a.atMs - b.atMs)
  if (!steps.length) throw new Error(`perform: no timeline steps${section ? ` for section "${section}"` : ''}`)
  for (const step of steps) {
    const wait = t0 + step.atMs - Date.now()
    if (wait > 0) await sleep(wait)
    if (step.op === 'message') await insertMessage(state, step)
    else if (step.op === 'agent-activity') await setAgentActivity(state, step)
    else if (step.op === 'mark-read') await markRead(state, step)
    else if (step.op === 'heartbeat') await heartbeat(state)
    else if (step.op === 'row') await insertRow(state, step)
    else throw new Error(`unknown timeline op: ${step.op}`)
    process.stdout.write(`[perform] +${((Date.now() - t0) / 1000).toFixed(1)}s ${step.op} ${step.from ?? step.who ?? step.table ?? ''}\n`)
  }
}

async function teardown(play, state) {
  const chatIds = Object.values(state.groups).map((g) => g.chatId)
  const agentIds = Object.values(state.agents).map((a) => a.id)
  const humanIds = Object.values(state.humans).map((h) => h.userId)
  const allIds = [...agentIds, ...humanIds]
  const del = async (label, fn) => {
    const { error } = await fn()
    if (error) throw new Error(`teardown.${label}: ${error.message}`)
  }
  if (chatIds.length) {
    const { data: msgs } = await chatAdmin.from('messages').select('id').in('chat_id', chatIds)
    const msgIds = (msgs ?? []).map((m) => m.id)
    if (msgIds.length) await del('deliveries', () => chatAdmin.from('message_deliveries').delete().in('message_id', msgIds))
    await del('messages', () => chatAdmin.from('messages').delete().in('chat_id', chatIds))
    await del('group_agent_states', () => chatAdmin.from('group_agent_states').delete().in('chat_id', chatIds))
    // 沉淀面（m4）：outputs 先于 tasks；workspace_items/catch_up_summaries 由 chats 级联
    await del('group_outputs', () => chatAdmin.from('group_outputs').delete().in('chat_id', chatIds))
    await del('group_tasks', () => chatAdmin.from('group_tasks').delete().in('chat_id', chatIds))
    // 先删 chats 再删 chat_members：chats_membership_invariants trigger 在 chats 行尚存时
    // 强制「群必须恰好 1 owner」，先删成员必炸；chats 行没了 trigger 早退（chat_members 对 chats 无 FK）。
    await del('chats', () => chatAdmin.from('chats').delete().in('id', chatIds))
    await del('chat_members', () => chatAdmin.from('chat_members').delete().in('chat_id', chatIds))
  }
  await del('device_commands', () => identityAdmin.from('gugu_device_commands').delete().in('user_id', humanIds))
  await del('runtime_states', () => identityAdmin.from('agent_runtime_states').delete().in('agent_user_id', agentIds))
  // agent 删除走产品 RPC（owner 身份），设备 FK RESTRICT 才解得开
  for (const [ref, agent] of Object.entries(state.agents)) {
    const owner = state.humans[agent.ownerRef]
    const client = await authed(owner.email)
    const { error } = await client.schema('identity').rpc('remove_owned_agent', { p_agent_user_id: agent.id })
    if (error) throw new Error(`teardown.agent(${ref}): ${error.message}`)
    await client.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  for (const h of Object.values(state.humans)) {
    const { error } = await admin.auth.admin.deleteUser(h.userId)
    if (error) throw new Error(`teardown.authUser(${h.email}): ${error.message}`)
  }
  // auth.deleteUser 不级联 identity.users / friendships（实测）——显式清
  await del('friendships', () => identityAdmin.from('friendships').delete().or(`user_a_id.in.(${allIds.join(',')}),user_b_id.in.(${allIds.join(',')})`))
  await del('identity.users', () => identityAdmin.from('users').delete().in('id', allIds))
  // 验证清零
  const { data: left } = await identityAdmin.from('users').select('id').in('id', allIds)
  if (left?.length) throw new Error(`teardown: ${left.length} identity.users rows still present`)
  process.stdout.write('[teardown] verified zero residue\n')
}

// ---------- main ----------
const args = process.argv.slice(2)
const playPath = args.find((a) => !a.startsWith('--'))
const get = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined }
const phase = get('phase')
const statePath = get('state') ?? 'screenplay-state.json'
if (!playPath || !phase) throw new Error('usage: node run.mjs <screenplay.json> --phase prepare|perform|teardown [--state state.json]')

const play = JSON.parse(await readFile(playPath, 'utf8'))
let state = { runId: Math.random().toString(36).slice(2, 8), humans: {}, agents: {}, groups: {} }
if (phase !== 'prepare') state = JSON.parse(await readFile(statePath, 'utf8'))

if (phase === 'prepare') { await prepare(play, state); await writeFile(statePath, JSON.stringify(state, null, 2)) ; process.stdout.write(`[prepare] state → ${statePath}\n${JSON.stringify(state.groups)}\n`) }
else if (phase === 'perform') await perform(play, state, get('section'))
else if (phase === 'heartbeat') { await heartbeat(state); process.stdout.write('[heartbeat] devices refreshed\n') } // 录制端 goto 前刷一把，开场帧 presence 不因 180s staleness 显离线
else if (phase === 'teardown') await teardown(play, state)
else throw new Error(`unknown phase: ${phase}`)
