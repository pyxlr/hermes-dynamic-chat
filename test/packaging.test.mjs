import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const artifact = new URL('../hermes-dynamic-chat/plugin.js', import.meta.url)

test('installable artifact embeds attribution, has only public imports and matches its checksum', async () => {
  const source = await readFile(artifact, 'utf8')
  const license = (await readFile(new URL('../LICENSE', import.meta.url), 'utf8')).trim()
  assert.ok(source.includes(license))
  assert.ok(source.includes("id: ID"))
  assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map(match => match[1]), ['@hermes/plugin-sdk'])
  assert.equal((await readFile(new URL('../CHECKSUMS.sha256', import.meta.url), 'utf8')).trim(), createHash('sha256').update(source).digest('hex') + '  hermes-dynamic-chat/plugin.js')
  assert.doesNotMatch(source, /THEMES_AREA|queryClient|__hermesCodex|fetch\(/)
})

test('build is repeatable and the manifest agrees with source metadata', async () => {
  const before = await readFile(artifact)
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build.mjs', import.meta.url))])
  assert.deepEqual(await readFile(artifact), before)
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const manifest = await readFile(new URL('../hermes-dynamic-chat/plugin.yaml', import.meta.url), 'utf8')
  assert.ok(manifest.includes('version: "' + pkg.version + '"'))
  assert.ok(manifest.includes('name: ' + pkg.name))
})
