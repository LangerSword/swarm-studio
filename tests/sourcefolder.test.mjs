// A project's source in a folder on this computer (engine/sourcefolder.mjs, issue #611): a checkout gets a branch of
// its own, a plain folder gets the files in a subfolder, and nothing the project did not write is overwritten
// without saying so first. Folders made here stand in for the person's home; nothing leaves them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cleanName, folderChanges, folderTarget, freeLocalBranch, toCheckout, toFolder } from '../engine/sourcefolder.mjs'

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'sourcefolder-')))
const put = (root, files) => { for (const [f, text] of Object.entries(files)) { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), text) } return root }
const g = (dir, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, encoding: 'utf8' }).trim()
const project = (files, at = tmp()) => { put(at, files); g(at, 'init', '-q'); g(at, 'add', '-A'); g(at, 'commit', '-qm', 'init'); return at }
const change = (dir, files) => { put(dir, files); g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'a change') }

test('a folder is one inside the home folder, never the home folder, the Studio\'s or Hermes\'s own; a checkout is told apart', () => {
  const home = tmp(), studio = join(home, '.hermes'), outside = tmp()
  mkdirSync(join(home, 'code', 'site'), { recursive: true }); mkdirSync(studio)
  project({ 'a.txt': 'a' }, join(home, 'code', 'repo'))
  assert.deepEqual(folderTarget('~/code/site', { home }), { folder: join(home, 'code', 'site'), checkout: false })
  assert.deepEqual(folderTarget(join(home, 'code', 'repo'), { home }), { folder: join(home, 'code', 'repo'), checkout: true })
  assert.throws(() => folderTarget(home, { home }), /inside your home folder/)
  assert.throws(() => folderTarget(outside, { home }), /inside your home folder/)
  assert.throws(() => folderTarget('code/site', { home }), /whole path/)
  assert.throws(() => folderTarget(join(studio), { home, deny: [studio] }), /Studio's own/)
  assert.throws(() => folderTarget(join(home, 'nope'), { home }), /No such folder/)
  assert.equal(cleanName(' web/site/ '), 'web/site')
  for (const bad of ['', '..', 'a/../b', '.git', 'a\0b']) assert.throws(() => cleanName(bad))
})

test('a checkout gets the project on a branch of its own; its own branch, files and other branches are not touched', async () => {
  const home = tmp(), dir = project({ 'index.html': 'mine' })
  const repo = project({ 'README.md': 'theirs' }, join(home, 'repo'))
  put(repo, { 'notes.txt': 'not committed' })
  const theirs = g(repo, 'rev-parse', 'HEAD')
  const branch = await freeLocalBranch(repo, 'Cedar Cafe')
  assert.equal(branch, 'swarm/cedar-cafe')
  const out = await toCheckout({ dir, folder: repo, branch })
  assert.equal(out.same, false)
  assert.equal(g(repo, 'rev-parse', `refs/heads/${branch}`), g(dir, 'rev-parse', 'HEAD'))
  assert.equal(g(repo, 'rev-parse', 'HEAD'), theirs, 'its checked-out branch is where it was')
  assert.equal(g(repo, 'symbolic-ref', '--short', 'HEAD'), 'main')
  assert.equal(readFileSync(join(repo, 'notes.txt'), 'utf8'), 'not committed', 'its working tree is as it was')
  assert.ok(!existsSync(join(repo, 'index.html')))
  assert.equal(g(repo, 'remote').trim(), '', 'nothing is set to push anywhere')
  // the next write is an ordinary one to the same branch; the same history twice is nothing to write
  change(dir, { 'index.html': 'mine, again' })
  assert.equal((await toCheckout({ dir, folder: repo, branch })).same, false)
  assert.equal(g(repo, 'rev-parse', `refs/heads/${branch}`), g(dir, 'rev-parse', 'HEAD'))
  assert.equal((await toCheckout({ dir, folder: repo, branch })).same, true)
  assert.equal(await freeLocalBranch(repo, 'Cedar Cafe'), 'swarm/cedar-cafe-2')
  // a commit made there on the branch is pulled first, never overwritten
  g(repo, 'checkout', '-q', branch); put(repo, { 'x.txt': 'x' }); g(repo, 'add', 'x.txt'); g(repo, 'commit', '-qm', 'theirs on the branch')
  change(dir, { 'index.html': 'mine, third' })
  await assert.rejects(toCheckout({ dir, folder: repo, branch }), /checked out in/)
  g(repo, 'checkout', '-q', 'main')
  await assert.rejects(toCheckout({ dir, folder: repo, branch }), e => e.pull === true && /has commits this project does not have/.test(e.message))
})

test('a checkout never gets a file that looks like a key, nor a branch name git does not take', async () => {
  const home = tmp(), repo = project({ 'README.md': 'x' }, join(home, 'repo'))
  const dir = project({ 'index.html': 'x', '.env': 'KEY=1' })
  await assert.rejects(toCheckout({ dir, folder: repo, branch: 'swarm/x' }), e => e.status === 422 && /\.env/.test(e.message))
  assert.ok(!g(repo, 'branch', '--list', 'swarm/x'))
  await assert.rejects(toCheckout({ dir: project({ 'a': 'a' }), folder: repo, branch: '../x' }), /branch name/)
})

test('a plain folder gets the files in a subfolder; a later write updates only what it wrote, and asks before any other file', async () => {
  const home = tmp(), folder = join(home, 'code')
  put(folder, { 'other/keep.txt': 'not the project\'s' })
  const dir = project({ 'index.html': 'v1', 'css/site.css': 'a{}' })
  let out = await toFolder({ dir, folder, sub: 'site' })
  assert.deepEqual({ added: out.added, overwrote: out.overwrote }, { added: 2, overwrote: 0 })
  assert.equal(readFileSync(join(folder, 'site', 'css', 'site.css'), 'utf8'), 'a{}')
  assert.ok(JSON.parse(readFileSync(join(folder, 'site', '.swarm-studio.json'), 'utf8')).files['index.html'])
  assert.equal(readFileSync(join(folder, 'other', 'keep.txt'), 'utf8'), 'not the project\'s')
  // the project changes: its own files are updated, and one it dropped is removed
  g(dir, 'rm', '-q', 'css/site.css'); change(dir, { 'index.html': 'v2' })
  out = await toFolder({ dir, folder, sub: 'site' })
  assert.deepEqual({ updated: out.updated, removed: out.removed }, { updated: 1, removed: 1 })
  assert.ok(!existsSync(join(folder, 'site', 'css', 'site.css')))
  // someone edits a file there, and adds one the project also has: the next write says so and writes nothing
  put(folder, { 'site/index.html': 'edited by hand' })
  change(dir, { 'index.html': 'v3', 'about.html': 'about' })
  put(folder, { 'site/about.html': 'their own about' })
  const no = await toFolder({ dir, folder, sub: 'site' }).catch(e => e)
  assert.equal(no.status, 409); assert.match(no.message, /2 files .* were not written by this project, or changed since: (index|about)\.html, (index|about)\.html\. Nothing was written/)
  assert.deepEqual(no.changes.theirs.sort(), ['about.html', 'index.html'])
  assert.equal(readFileSync(join(folder, 'site', 'index.html'), 'utf8'), 'edited by hand')
  // with a yes, they are written
  out = await toFolder({ dir, folder, sub: 'site', confirm: true })
  assert.equal(out.overwrote, 2)
  assert.equal(readFileSync(join(folder, 'site', 'index.html'), 'utf8'), 'v3')
  assert.equal((await toFolder({ dir, folder, sub: 'site' })).same, true)
})

test('a plain folder never gets a key file, never leaves the folder, and a checkout inside it is not written into', async () => {
  const home = tmp(), folder = join(home, 'code')
  mkdirSync(folder, { recursive: true })
  await assert.rejects(toFolder({ dir: project({ 'index.html': 'x', 'certs/site.pem': 'k' }), folder, sub: 'site' }), e => e.status === 422 && /certs\/site\.pem/.test(e.message))
  assert.ok(!existsSync(join(folder, 'site', 'index.html')))
  await assert.rejects(toFolder({ dir: project({ 'a': 'a' }), folder, sub: '../out' }), /plain names/)
  project({ 'README.md': 'x' }, join(folder, 'repo'))
  await assert.rejects(toFolder({ dir: project({ 'a': 'a' }), folder, sub: 'repo' }), /is a git checkout/)
  // what a write would do, said before it does it
  const c = await folderChanges({ dir: project({ 'a.txt': 'a' }), target: join(folder, 'new') })
  assert.deepEqual({ add: c.add, theirs: c.theirs }, { add: ['a.txt'], theirs: [] })
})
