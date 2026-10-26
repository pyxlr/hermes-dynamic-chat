import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')

async function loadPlugin() {
  const source = await readFile(new URL('../src/plugin.js', import.meta.url), 'utf8')
  const sdk = moduleUrl('export const PALETTE_AREA="palette"; export const host={notify:input=>globalThis.__dynamicChatTestNotices?.push(input)};')
  assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map(match => match[1]), ['@hermes/plugin-sdk'])
  return (await import(moduleUrl(source.replace("from '@hermes/plugin-sdk'", `from '${sdk}'`)))).default
}

function context(initial) {
  const values = new Map(initial === undefined ? [] : [['composer-width', initial]])
  const entries = [], cleanups = [], writes = []
  return { entries, cleanups, writes, values,
    storage: { get: (key, fallback) => values.has(key) ? values.get(key) : fallback, set: (key, value) => { writes.push([key, value]); values.set(key, value) } },
    register: entry => { entries.push(entry); return () => {} }, onDispose: fn => cleanups.push(fn) }
}

// Registration can run before the renderer document exists.
test('standalone command cycles all original width presets and saves only its own preference', async () => {
  const plugin = await loadPlugin(), ctx = context()
  assert.equal(plugin.id, 'hermes-dynamic-chat')
  assert.equal(plugin.defaultEnabled, false)
  plugin.register(ctx)
  assert.equal(ctx.entries.length, 1)
  const command = ctx.entries[0]
  assert.equal(command.area, 'palette')
  assert.equal(command.data.label, 'Dynamic Chat: Composer width')
  assert.equal(command.data.keepOpen, true)
  assert.equal(command.data.detail(), '736 px')
  for (const [mode, label] of [['wide', '883.2 px (+20%)'], ['wider', '1030.4 px (+40%)'], ['hermes', 'Hermes (full width)'], ['compact', '736 px']]) {
    assert.equal(command.data.run(), true)
    assert.equal(ctx.values.get('composer-width'), mode)
    assert.equal(command.data.detail(), label)
  }
  assert.equal(ctx.writes.length, 4)
  ctx.cleanups.forEach(fn => fn())
})

test('saved settings survive registration without importing legacy Codex values', async () => {
  const plugin = await loadPlugin()
  for (const [initial, label] of [['wide', '883.2 px (+20%)'], ['hermes', 'Hermes (full width)'], ['codex-wide', '736 px'], [null, '736 px'], [{ bad: true }, '736 px']]) {
    const ctx = context(initial)
    plugin.register(ctx)
    assert.equal(ctx.entries[0].data.detail(), label)
    assert.equal(ctx.writes.length, 0)
    ctx.cleanups.forEach(fn => fn())
  }
})

test('read, write and silent persistence failures never report a successful change', async () => {
  const plugin = await loadPlugin()
  for (const failure of ['read', 'write', 'silent']) {
    const ctx = context('compact'), notices = []
    globalThis.__dynamicChatTestNotices = notices
    plugin.register(ctx)
    if (failure === 'read') ctx.storage.get = () => { throw new Error('unavailable') }
    if (failure === 'write') ctx.storage.set = () => { throw new Error('quota') }
    if (failure === 'silent') ctx.storage.set = () => {}
    assert.equal(ctx.entries[0].data.run(), false)
    assert.equal(ctx.entries[0].data.detail(), '736 px')
    assert.equal(notices.length, 1)
    assert.equal(ctx.writes.length, 0)
    ctx.cleanups.forEach(fn => fn())
  }
  delete globalThis.__dynamicChatTestNotices
})

test('actions rebase on the latest persisted choice and stop after disposal', async () => {
  const plugin = await loadPlugin(), ctx = context()
  plugin.register(ctx)
  ctx.values.set('composer-width', 'wide')
  assert.equal(ctx.entries[0].data.run(), true)
  assert.equal(ctx.values.get('composer-width'), 'wider')
  ctx.cleanups.forEach(fn => fn())
  assert.equal(ctx.entries[0].data.run(), false)
  assert.equal(ctx.writes.length, 1)
})
