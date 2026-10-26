import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function chromium() {
  const executable = [process.env.CHROME_BIN, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path))
  assert.ok(executable, 'Set CHROME_BIN to a Chrome or Chromium executable for browser tests')
  const profile = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'dynamic-chat-chrome-'))
  const child = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--user-data-dir=' + profile, '--remote-debugging-pipe'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  let serial = 0, buffer = '', stderr = ''
  const pending = new Map()
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000) })
  const fail = error => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
    pending.clear()
  }
  child.on('error', fail)
  child.on('exit', () => fail(new Error('Chrome exited: ' + stderr)))
  child.stdio[4].on('data', chunk => {
    buffer += chunk.toString()
    let end
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      const entry = pending.get(message.id)
      if (!entry) continue
      clearTimeout(entry.timer); pending.delete(message.id)
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 15000)
    pending.set(id, { resolve, reject, timer })
    child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
  })
  const close = async () => {
    fail(new Error('Browser test ended'))
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGKILL')
      await exited
    }
    await rm(profile, { recursive: true, force: true })
  }
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const call = (method, params) => send(method, params, sessionId)
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await call('Page.enable')
    return { call, evaluate, close }
  } catch (error) { await close(); throw error }
}
