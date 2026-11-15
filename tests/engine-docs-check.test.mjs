// The engine-docs check itself (scripts/engine-docs-check.mjs): a Glue entry that names a part of a shared file
// (`server/server.mjs#meshy`) owes its page only when the change's lines fall inside that part's blocks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { parts, hunks, touched, problems, unread } from '../scripts/engine-docs-check.mjs'

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'engine-docs-check.mjs')
const FILE = [
  'const a = 1',             // 1
  '// engine: meshy',        // 2
  'const meshy = 2',         // 3
  '// end engine: meshy',    // 4
  'const b = 3',             // 5
  '  // engine: meshy',      // 6
  '  const more = 4',        // 7
  '  // end engine: meshy',  // 8
  '# engine: sound',         // 9
  'const sound = 5',         // 10
  '# end engine: sound',     // 11
  'const c = 6',             // 12
].join('\n')

test('parts: every block of a part, markers included, in // and # comments', () => {
  const { parts: p, errors } = parts(FILE)
  assert.deepEqual(p, { meshy: [[2, 4], [6, 8]], sound: [[9, 11]] })
  assert.deepEqual(errors, [])
  assert.deepEqual(parts(FILE.replace(/\n/g, '\r\n')).parts, p, 'Windows line ends read the same')
})

test('parts: a part left open, opened twice or closed twice is an error', () => {
  assert.match(parts('// engine: x\nconst a = 1').errors[0], /never closed/)
  assert.match(parts('// engine: x\n// engine: x\n// end engine: x').errors[0], /already open/)
  assert.match(parts('// end engine: x').errors[0], /closes nothing/)
})

test('hunks: the removed and added lines of a -U0 diff', () => {
  assert.deepEqual(hunks('@@ -3 +3 @@\n-x\n+y\n@@ -10,0 +11,2 @@\n+p\n+q\n@@ -20,2 +21,0 @@\n-r\n-s\n'),
    { removed: [3, 20, 21], added: [3, 11, 12] })
})

test('touched: a change inside a part touches it, a change outside does not', () => {
  const at = n => `@@ -${n} +${n} @@`
  assert.equal(touched({ part: 'meshy', now: FILE, before: FILE, diff: at(3) }), true)
  assert.equal(touched({ part: 'meshy', now: FILE, before: FILE, diff: at(7) }), true, 'the second block')
  assert.equal(touched({ part: 'meshy', now: FILE, before: FILE, diff: at(2) }), true, 'a marker line')
  assert.equal(touched({ part: 'meshy', now: FILE, before: FILE, diff: at(5) }), false)
  assert.equal(touched({ part: 'meshy', now: FILE, before: FILE, diff: at(10) }), false, "another engine's part")
  assert.equal(touched({ part: 'sound', now: FILE, before: FILE, diff: at(10) }), true)
  // lines removed from a part: numbered as at the base
  const now = FILE.split('\n').filter((_, i) => i !== 2).join('\n')
  assert.equal(touched({ part: 'meshy', now, before: FILE, diff: '@@ -3 +2,0 @@' }), true)
})

test('problems: a part the file does not mark is caught', () => {
  const page = { file: 'docs/engines/x.md', glue: ['server/s.mjs#meshy', 'server/s.mjs#godot'], text: '' }
  assert.deepEqual(problems(page, () => true, () => FILE), ['docs/engines/x.md: Glue names server/s.mjs#godot, but server/s.mjs has no "// engine: godot" … "// end engine: godot" block'])
})

test('unread: a part entry needs its file changed and the part hit; whole files and folders as before', () => {
  const all = [{ file: 'docs/engines/meshy.md', glue: ['server/s.mjs#meshy', 'engine/meshy.mjs'] }]
  assert.deepEqual(unread(['server/s.mjs'], all, '', () => true), ['docs/engines/meshy.md'])
  assert.deepEqual(unread(['server/s.mjs'], all, '', () => false), [])
  assert.deepEqual(unread(['engine/meshy.mjs'], all, '', () => false), ['docs/engines/meshy.md'])
  assert.deepEqual(unread(['server/s.mjs'], all, 'Read docs/engines/meshy.md', () => true), [])
})

// the script as CI runs it, `--base main` in a repo of its own
test('the check: a change inside a part fails without the page, a change outside passes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-docs-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' })
  const page = '# Meshy\n\nGlue: server/s.mjs#meshy\n\n## What it already does\n- Makes characters (server/s.mjs:3).\n'
  mkdirSync(join(dir, 'docs', 'engines'), { recursive: true })
  mkdirSync(join(dir, 'server'))
  writeFileSync(join(dir, 'docs', 'engines', 'meshy.md'), page)
  writeFileSync(join(dir, 'server', 's.mjs'), `${FILE}\n`)
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-qm', 'base')
  const run = () => spawnSync(process.execPath, [SCRIPT, '--base', 'main'], { cwd: dir, encoding: 'utf8', env: { ...process.env, ENGINE_DOCS_ROOT: dir, GITHUB_EVENT_PATH: '' } })
  const change = (branch, from, to) => {
    git('checkout', '-q', '-b', branch, 'main')
    const f = join(dir, 'server', 's.mjs')
    writeFileSync(f, readFileSync(f, 'utf8').replace(from, to))
    git('commit', '-qam', branch)
  }

  assert.equal(spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env: { ...process.env, ENGINE_DOCS_ROOT: dir } }).status, 0, 'the page is sound')

  change('outside', 'const b = 3', 'const b = 30')
  const out = run()
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /every touched engine page/)

  change('inside', 'const meshy = 2', 'const meshy = 20')
  const ins = run()
  assert.equal(ins.status, 1)
  assert.match(ins.stderr, /docs\/engines\/meshy\.md/)

  change('removed', 'const meshy = 2\n', '')
  assert.equal(run().status, 1, 'a line taken out of the part')

  change('other-part', 'const sound = 5', 'const sound = 50')
  assert.equal(run().status, 0, "a change in another engine's part")
})
