import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '/tmp/status'
const TAB = 'tab-1'

type Written = Record<string, unknown>

/** The world beneath the plugin: the engine's answers nothing in a test gives on its own. */
const bottom = (
  on: On,
  usage: { window: number; tokens?: number; cost?: number },
  envWrites: (string | undefined)[] = []
) => {
  const writes: Written[] = []
  on('fs.write', ($, e) => {
    writes.push(JSON.parse(e.text) as Written)
    return { value: undefined }
  })
  on('env.set', ($, e) => {
    envWrites.push(e.value)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: usage.window, tokens: usage.tokens },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 12.5, resetsAt: '2026-10-06T20:00:00Z' },
        { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-10T18:00:00Z' }
      ],
      cost: usage.cost === undefined ? undefined : { usd: usage.cost }
    }
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.PermissionRequest', () => ({}))
  // The engine's own stream, with nothing to stream: only the result counts beneath a test
  // eslint-disable-next-line require-yield
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: USAGE
    }
  })
  return writes
}

const last = (writes: Written[]) => writes[writes.length - 1]!

const USAGE = {
  model: 'claude-fable-5-1',
  input_tokens: 1200,
  output_tokens: 80,
  cache_read_input_tokens: 100_000,
  cache_creation_input_tokens: 800
}

test('a step writes the live context, a tool call the row text, the turn end the idle state', async ($, on) => {
  const writes = bottom(on, { window: 1_000_000, cost: 0.5 })
  mock.env(on, { CLAUDE_PANEL_STATUS_DIR: DIR, CLAUDE_PANEL_TAB_ID: TAB })
  const clock = mock.clock(on, { now: 1_000 })
  on('tool.call', { tool: 'Bash' }, async () => {
    await clock.advance(400)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })

  await $.session.start({ cwd: '/Users/me/p', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  expect(writes.length).toBe(1)
  expect(last(writes).state).toBe('idle')
  expect(last(writes).cwd).toBe('/Users/me/p')
  expect(last(writes).totalTokens).toBeUndefined()
  expect(last(writes).sessionPercent).toBe(12.5)
  expect(last(writes).costUsd).toBe(0.5)

  await $.turn.start({ turnId: 't1', text: 'compile it' })
  await clock.advance(200)
  expect(last(writes).state).toBe('busy')

  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'c1', command: '  npm   run compile ' })
  await clock.advance(150)
  expect(last(writes).tool).toEqual({ name: 'Bash', summary: 'npm run compile' })
  await call
  await clock.advance(150)
  expect(last(writes).tool).toBeUndefined()

  const step = $.turn.step({
    turnId: 't1',
    index: 2,
    model: 'claude-fable-5-1',
    effort: 'high',
    messageCount: 9
  })
  // the engine's own stream: nothing beneath yields, so only the result counts
  for await (const _chunk of step) {
    // no chunks beneath a test
  }
  await clock.advance(150)
  expect(last(writes).usedTokens).toBe(1200 + 100_000 + 800)
  expect(last(writes).totalTokens).toBe(1_000_000)
  expect(last(writes).usedPercent).toBe(10.2)
  expect(last(writes).stepIndex).toBe(2)
  expect(last(writes).modelId).toBe('claude-fable-5-1')
  expect(last(writes).effort).toBe('high')

  await $.turn.complete({
    turnId: 't1',
    answer: 'done',
    durationMs: 900,
    isAborted: false,
    reason: 'answer',
    usage: USAGE
  })
  await clock.advance(150)
  expect(last(writes).state).toBe('idle')
})

test('a permission request asks, a nested session is kept off, /clear resets the counters', async ($, on) => {
  const envWrites: (string | undefined)[] = []
  const writes = bottom(on, { window: 200_000 }, envWrites)
  mock.env(on, {
    CLAUDE_PANEL_STATUS_DIR: DIR,
    CLAUDE_PANEL_TAB_ID: TAB,
    // The test's `$` has no plugin noun, so the own folder cannot be named here; what the mod
    // must keep is what this checks.
    CLAUDE_CODE_PLUGIN_DIRS: '/Users/me/own-mod'
  })
  const clock = mock.clock(on, { now: 5_000 })

  await $.session.start({ cwd: '/Users/me/p', surface: 'terminal', isInteractive: true })
  expect(envWrites).toEqual(['/Users/me/own-mod'])

  await $.turn.start({ turnId: 't2', text: 'rm it' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm x' } })
  await clock.advance(150)
  expect(last(writes).state).toBe('asking')

  await $.session.measure({
    context: { window: 200_000, tokens: 50_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 33 }],
    cost: { usd: 2 },
    changed: ['context', 'rateLimits', 'cost']
  })
  await clock.advance(150)
  expect(last(writes).usedTokens).toBe(50_000)
  expect(last(writes).usedPercent).toBe(25)
  expect(last(writes).sessionPercent).toBe(33)
  expect(last(writes).costUsd).toBe(2)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  const final = last(writes)
  expect(final.state).toBe('idle')
  expect(final.usedTokens).toBeUndefined()
  expect(final.compacted).toBe(0)
  expect(final.costUsd).toBe(0)
  // Wall-clock on purpose: the watcher compares it with the producer's own timestamps
  expect((final.resetAt as number) > 0).toBe(true)
})

test('without the panel variables the mod writes nothing', async ($, on) => {
  const writes = bottom(on, { window: 200_000 })
  mock.env(on, {})
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  await $.turn.start({ turnId: 't3', text: 'hi' })
  await clock.advance(500)
  expect(writes.length).toBe(0)
})

/** What `GET /api/oauth/usage` answers for a Max account with a Fable bucket, trimmed. */
const USAGE_BODY = {
  five_hour: { utilization: 52, resets_at: '2026-10-06T09:49:59.614342+00:00' },
  seven_day: { utilization: 41, resets_at: '2026-10-09T17:59:59.614363+00:00' },
  limits: [
    { kind: 'session', group: 'session', percent: 52, resets_at: '2026-10-06T09:49:59.614342+00:00', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 41, resets_at: '2026-10-09T17:59:59.614363+00:00', scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 79,
      resets_at: '2026-10-09T17:59:59.614570+00:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null }
    }
  ]
}

test('the usage endpoint fills the per-model buckets: at start, after a turn, and on the clock', async ($, on) => {
  const writes = bottom(on, { window: 1_000_000 })
  mock.env(on, { CLAUDE_PANEL_STATUS_DIR: DIR, CLAUDE_PANEL_TAB_ID: TAB })
  const clock = mock.clock(on, { now: 1_000 })
  const asked: string[] = []
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' as const } }))
  on('http.fetch', (_, e) => {
    asked.push(`${e.init?.auth}:${e.init?.method ?? 'GET'}:${e.url}`)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(USAGE_BODY) } }
  })

  await $.session.start({ cwd: '/Users/me/p', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  expect(asked).toEqual(['h1:GET:https://api.anthropic.com/api/oauth/usage'])
  // The host's shape: label, percent, reset as epoch seconds. Only the model-scoped rows.
  expect(last(writes).modelWeeks).toEqual([{ label: 'Fable', percent: 79, resetsAt: 1_791_568_800 }])

  // A turn ending within the minute does not ask again; the endpoint caches for that long.
  await $.turn.start({ turnId: 't5', text: 'hi' })
  await $.turn.complete({ turnId: 't5', answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage: USAGE })
  await clock.advance(200)
  expect(asked.length).toBe(1)

  // Past the minute, the next turn end asks.
  await clock.advance(61_000)
  await $.turn.start({ turnId: 't6', text: 'hi' })
  await $.turn.complete({ turnId: 't6', answer: 'ok', durationMs: 10, isAborted: false, reason: 'answer', usage: USAGE })
  await clock.advance(200)
  expect(asked.length).toBe(2)

  // Idle, the clock asks every five minutes.
  await clock.advance(5 * 60_000 + 200)
  expect(asked.length).toBe(3)
  expect(last(writes).modelWeeks).toEqual([{ label: 'Fable', percent: 79, resetsAt: 1_791_568_800 }])
})

test('no credential or a failed usage call leaves the buckets out and the row standing', async ($, on) => {
  const writes = bottom(on, { window: 1_000_000 })
  mock.env(on, { CLAUDE_PANEL_STATUS_DIR: DIR, CLAUDE_PANEL_TAB_ID: TAB })
  const clock = mock.clock(on, { now: 1_000 })
  let asked = 0
  on('session.authorize', () => ({ value: null }))
  on('http.fetch', () => {
    asked += 1
    return { value: { status: 401, ok: false, headers: {}, text: '{"error":"no"}' } }
  })

  await $.session.start({ cwd: '/Users/me/p', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  expect(asked).toBe(0)
  expect(last(writes).modelWeeks).toBeUndefined()
  expect(last(writes).state).toBe('idle')
})

test('a usage call that fails keeps the last buckets', async ($, on) => {
  const writes = bottom(on, { window: 1_000_000 })
  mock.env(on, { CLAUDE_PANEL_STATUS_DIR: DIR, CLAUDE_PANEL_TAB_ID: TAB })
  const clock = mock.clock(on, { now: 1_000 })
  let calls = 0
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' as const } }))
  on('http.fetch', () => {
    calls += 1
    if (calls === 1) return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(USAGE_BODY) } }
    return { value: { status: 500, ok: false, headers: {}, text: 'down' } }
  })

  await $.session.start({ cwd: '/Users/me/p', surface: 'terminal', isInteractive: true })
  await clock.advance(200)
  expect(last(writes).modelWeeks).toEqual([{ label: 'Fable', percent: 79, resetsAt: 1_791_568_800 }])
  await clock.advance(5 * 60_000 + 200)
  expect(calls).toBe(2)
  expect(last(writes).modelWeeks).toEqual([{ label: 'Fable', percent: 79, resetsAt: 1_791_568_800 }])
})
