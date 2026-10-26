import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = fileURLToPath(new URL('../scripts/package-release.py', import.meta.url))
const digest = data => createHash('sha256').update(data).digest('hex')
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version

test('release package contains the exact plugin, licenses, README and verifiable checksums', async () => {
  const base = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'chat-release-test-'))
  try {
    const output = join(base, 'release')
    const result = spawnSync('python3', [script, '--version', version, '--output', output], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, 'release packaging is missing or failed: ' + result.stderr)
    const metadata = JSON.parse(result.stdout)
    assert.equal(metadata.tag, 'v' + version)
    assert.equal(metadata.prerelease, version.includes('-'))
    const plugin = await readFile(join(root, 'hermes-dynamic-chat/plugin.js'))
    assert.deepEqual(await readFile(join(output, 'plugin.js')), plugin)
    const checksums = (await readFile(join(output, 'CHECKSUMS.sha256'), 'utf8')).trim().split('\n')
    assert.equal(checksums.length, 5)
    for (const line of checksums) {
      const [expected, name] = line.split('  ')
      assert.equal(digest(await readFile(join(output, name))), expected, name)
    }
    const zipResult = execFileSync('python3', ['-c',
      'import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps(sorted(z.namelist())))',
      join(output, metadata.archive)], { encoding: 'utf8' })
    assert.deepEqual(JSON.parse(zipResult), ['CHECKSUMS.sha256', 'LICENSE', 'README.md', 'plugin.js', 'plugin.yaml'].map(name => 'hermes-dynamic-chat/' + name))
    const other = join(base, 'second')
    execFileSync('python3', [script, '--version', version, '--output', other], { cwd: root })
    assert.deepEqual(await readFile(join(output, metadata.archive)), await readFile(join(other, metadata.archive)), 'archive is deterministic')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('release packaging rejects mismatched versions and unsafe version strings', async () => {
  const base = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'chat-release-invalid-'))
  try {
    for (const invalid of ['99999.99999.99999', 'v0.1.0', '01.1.0', '0.1.0; echo unsafe', '../0.1.0', '0.1.0-01']) {
      const result = spawnSync('python3', [script, '--version', invalid, '--output', join(base, 'release')], { cwd: root, encoding: 'utf8' })
      assert.notEqual(result.status, 0, invalid)
      assert.match(result.stderr, /Release packaging failed:/)
    }
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('prerelease validation accepts matching RC versions and rejects manifest or checksum drift', async () => {
  const base = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'chat-release-metadata-'))
  try {
    await mkdir(join(base, 'hermes-dynamic-chat'))
    for (const file of ['LICENSE', 'README.md', 'CHECKSUMS.sha256', 'hermes-dynamic-chat/plugin.js', 'hermes-dynamic-chat/plugin.yaml', 'package.json']) {
      await copyFile(join(root, file), join(base, file))
    }
    const packagePath = join(base, 'package.json'), manifestPath = join(base, 'hermes-dynamic-chat/plugin.yaml')
    const packageData = JSON.parse(await readFile(packagePath, 'utf8'))
    const original = await readFile(manifestPath, 'utf8')
    packageData.version = '0.2.0-rc.1'
    await writeFile(packagePath, JSON.stringify(packageData))
    const run = () => spawnSync('python3', [script, '--root', base, '--version', '0.2.0-rc.1', '--check-only'], { encoding: 'utf8' })
    assert.notEqual(run().status, 0, 'manifest mismatch cannot be released')
    await writeFile(manifestPath, original.replace(/^version:.*$/m, 'version: "0.2.0-rc.1"'))
    const valid = run()
    assert.equal(valid.status, 0, valid.stderr)
    assert.equal(JSON.parse(valid.stdout).prerelease, true)
    await writeFile(join(base, 'hermes-dynamic-chat/plugin.js'), 'changed bundle')
    assert.notEqual(run().status, 0, 'changed bundle cannot be released')
  } finally { await rm(base, { recursive: true, force: true }) }
})
