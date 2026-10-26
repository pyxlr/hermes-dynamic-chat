import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const release = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const inlinePython = [...release.matchAll(/python3 - <<'PY'\n([\s\S]*?)\n          PY/g)].map(match => match[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n'))

function python(source) {
  const result = spawnSync('python3', ['-c', source], { encoding: 'utf8', cwd: root })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('workflows target Dynamic Chat and keep release publication opt-in', async () => {
  for (const source of [ci, release]) {
    assert.doesNotMatch(source, /sidebar/i)
    assert.match(source, /git diff --exit-code -- hermes-dynamic-chat\/plugin\.js CHECKSUMS\.sha256/)
    assert.match(source, /persist-credentials: false/)
    assert.match(source, /node-version: 22/)
    assert.match(source, /run: npm ci --ignore-scripts --no-audit --no-fund/)
  }
  assert.match(ci, /^name: Dynamic Chat CI/m)
  assert.match(release, /^name: Create Dynamic Chat release/m)
  assert.match(release, /workflow_dispatch:/)
  assert.doesNotMatch(release, /^  (push|pull_request):/m)
  assert.match(release, /if: github.ref == 'refs\/heads\/main'/)
  assert.match(release, /--draft --latest=false --target "\$RELEASE_SHA"/)
  assert.match(release, /digest-mismatch: error/)
  assert.match(release, /gh release download "\$RELEASE_TAG" --dir release-readback/)
  assert.equal((release.match(/name: dynamic-chat-release/g) || []).length, 2)
  assert.ok((await readFile(new URL('../scripts/package-release.py', import.meta.url), 'utf8')).includes('hermes-dynamic-chat'))
})

test('all embedded Python blocks compile', () => {
  assert.equal(inlinePython.length, 3)
  inlinePython.forEach((source, index) => python('compile(' + JSON.stringify(source) + ', "workflow-block-' + index + '", "exec")'))
})

test('exact release preflight rejects existing releases, wrong tags and API failures', () => {
  // Mocked HTTP responses exercise decisions without creating any remote state.
  python(`
import io, json, os, urllib.error
from unittest.mock import patch
sha = 'a' * 40
cases = [
 ('absent', {}, None, True),
 ('matching tag', {'/git/ref/tags/v0.1.0': {'object': {'type': 'commit', 'sha': sha}}}, None, True),
 ('annotated tag', {'/git/ref/tags/v0.1.0': {'object': {'type': 'tag', 'sha': 'b' * 40}}, '/git/tags/' + 'b' * 40: {'object': {'type': 'commit', 'sha': sha}}}, None, True),
 ('wrong tag', {'/git/ref/tags/v0.1.0': {'object': {'type': 'commit', 'sha': 'c' * 40}}}, None, False),
 ('existing release', {'/releases/tags/v0.1.0': {'id': 1}}, None, False),
 ('authentication error', {}, 403, False),
 ('server error', {}, 500, False),
]
for name, replies, error_code, allowed in cases:
 def request(request, timeout=30):
  path = request.full_url.split('/repos/example/dynamic-chat')[1]
  if error_code or path not in replies:
   raise urllib.error.HTTPError(request.full_url, error_code or 404, 'test response', None, None)
  return io.BytesIO(json.dumps(replies[path]).encode())
 succeeded = True
 with patch.dict(os.environ, {'GH_REPO': 'example/dynamic-chat', 'RELEASE_TAG': 'v0.1.0', 'RELEASE_SHA': sha, 'GH_TOKEN': 'fixture-only'}), patch('urllib.request.urlopen', request):
  try:
   exec(${JSON.stringify(inlinePython[1])}, {})
  except (SystemExit, urllib.error.HTTPError):
   succeeded = False
 assert succeeded == allowed, name
`)
})
