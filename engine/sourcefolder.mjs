// A project's source in a folder on this computer (docs/specs/45-intake.md, "A folder on this computer"; issue #611):
// the third way beside a new GitHub repository and an existing one. The run's own history (runs/<id>/app/.git) is
// written there, and read back from there by Pull (as Bring in reads a folder).
//   - A git checkout gets this project's commits on a NEW BRANCH of its own (swarm/<name>), fetched into it from the
//     run: its working tree, its checked-out branch and its other branches are not touched, and nothing is pushed
//     anywhere from it. A later write goes on to that branch, only when it is an ordinary one (no force).
//   - A plain folder gets the project's files written into a subfolder the person names. A file there the project
//     did not write (or wrote, and someone changed since) is never overwritten without saying which, first; the
//     project's own record of what it wrote is .swarm-studio.json in that subfolder.
//   Only a folder inside the person's home folder, never the home folder itself, never the Studio's runs or data,
//   Hermes's home or the plugin's own folder (engine/bringin.mjs checkFolder); a file that looks like a key is
//   never written (engine/sourcehub.mjs keyFile), and the commits are checked for one as a push's are.
// git runs as a push's does (engine/sourcehub.mjs git: a minimal environment, no hook, nothing asked), plus no
// fsmonitor of the checkout's own; nothing of the project or the checkout is run.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { checkFolder, CAPS } from './bringin.mjs'
import { GITHUB, git, isBehind, keyFile, keyFilesIn, localHead, repoName, saveChanges } from './sourcehub.mjs'
import { execFile } from './proc.mjs'

const fail = (message, status = 400, more = {}) => Object.assign(new Error(message), { status, ...more })
// git may read the run's history from its path (a local fetch), and the checkout's own fsmonitor never runs
const LOCAL = { ...GITHUB, file: true }
const NO_FSMONITOR = ['-c', 'core.fsmonitor=false']
const said = text => String(text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(-2).join(' ').slice(0, 240)
const MANIFEST = '.swarm-studio.json'
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/

/** The folder named, checked: inside the home folder and none of the Studio's or Hermes's own (`deny`). A git
 * checkout (a .git folder, or the .git file of a worktree) or a plain folder. ~ is the home folder.
 * → { folder: its real path, checkout } */
export function folderTarget(given, { home, deny = [] } = {}) {
  const s = String(given ?? '').trim().replace(/^~(?=$|[\\/])/, home || '~')
  const folder = checkFolder(s, { home, deny })
  const checkout = existsSync(join(folder, '.git'))
  // a folder inside a checkout (its working tree) is that checkout's: files are never written into it loose
  let within = null
  if (!checkout) {
    const top = realpathSync(home)
    for (let d = dirname(folder); d.length >= top.length && d !== dirname(d); d = dirname(d)) {
      if (existsSync(join(d, '.git'))) { within = d; break }
      if (d === top) break
    }
  }
  return { folder, checkout, within }
}

/** What a typed path means: the folder named itself when it is a checkout; otherwise the folder the files go in,
 * made inside its parent when it is not there yet (the chat's "save this into ~/code/site"). → { folder, checkout, sub } */
export function pathTarget(given, { home, deny = [] } = {}) {
  let at = null
  try { at = folderTarget(given, { home, deny }) } catch (err) { if (!/No such folder/.test(err.message)) throw err }
  if (at?.checkout) return { ...at, sub: null }
  const p = resolve(String(given ?? '').trim().replace(/^~(?=$|[\\/])/, home || '~').replace(/[\\/]+$/, ''))
  const parent = folderTarget(dirname(p), { home, deny })
  return { ...parent, sub: cleanName(basename(p)) }
}

/** A subfolder's name for a plain folder: one or more plain names, never leaving the folder. → 'site' or 'web/site' */
export function cleanName(given) {
  const s = String(given ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!s) throw fail('Name the subfolder the files go in')
  const parts = s.split('/')
  if (s.length > 200 || parts.some(p => !p || p === '.' || p === '..' || !/^[\w .-]{1,100}$/.test(p) || p.startsWith('.'))) throw fail('A subfolder is plain names: letters, numbers, dashes and dots, no ".."')
  return parts.join('/')
}

// ---------- a git checkout: this project's commits on a branch of its own
/** a branch name the checkout does not have yet: swarm/<name>, else -2, -3 … */
export async function freeLocalBranch(folder, title) {
  const want = `swarm/${repoName(title)}`
  const r = await git(folder, [...NO_FSMONITOR, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'], LOCAL)
  if (!r.ok) throw fail(`${folder} is not a git checkout git can read: ${said(r.err)}`, 409)
  const have = new Set(r.out.split('\n').map(x => x.trim()).filter(Boolean))
  for (let n = 1; n < 50; n++) { const b = n === 1 ? want : `${want}-${n}`; if (!have.has(b)) return b }
  throw fail(`${folder} has too many branches named ${want}`, 409)
}

/** Write the run's history into the checkout as `branch`: fetched from the run, never with + (an ordinary update
 * only), never into the branch the checkout has out. → { sha, same } */
export async function toCheckout({ dir, folder, branch, step = () => {} }) {
  if (!BRANCH.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.endsWith('.lock')) throw fail('Not a branch name git takes')
  await saveChanges(dir, GITHUB, step)
  const head = await localHead(dir)
  if (!head) throw fail('Nothing to write yet: this project has no history', 409)
  const keys = await keyFilesIn(dir, 'HEAD')
  if (keys.length) throw fail(`Not written. ${keys.length === 1 ? 'This file looks' : 'These files look'} like keys: ${keys.slice(0, 8).join(', ')}. Take ${keys.length === 1 ? 'it' : 'them'} out of the project first.`, 422, { keys })
  const out = await git(folder, [...NO_FSMONITOR, 'symbolic-ref', '-q', '--short', 'HEAD'], LOCAL)
  if (out.ok && out.out.trim() === branch) throw fail(`${branch} is checked out in ${folder}: switch that checkout to another branch, and write again`, 409)
  const was = await git(folder, [...NO_FSMONITOR, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`], LOCAL)
  if (was.ok && was.out.trim() === head.sha) return { sha: head.sha, same: true }
  // the branch has commits this history lacks (made in the checkout): they are pulled first, never written over
  if (was.ok && !(await isBehind(dir, was.out.trim()))) throw fail(`${branch} in ${folder} has commits this project does not have. Pull them first.`, 409, { pull: true })
  step(`writing to ${branch}`)
  const f = await git(folder, [...NO_FSMONITOR, 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--', dir, `HEAD:refs/heads/${branch}`], LOCAL, { timeout: 600000 })
  if (!f.ok) {
    if (/non-fast-forward|rejected/i.test(f.err)) throw fail(`${branch} in ${folder} has commits this project does not have. Pull them first.`, 409, { pull: true })
    throw fail(`Could not write to ${folder}: ${said(f.err) || 'git stopped'}`, 502)
  }
  return { sha: head.sha, same: false }
}

// ---------- a plain folder: the files, in a subfolder
// git's own name for a file's content (a blob's id), so what the project wrote can be told from what changed since
const blobId = buf => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
const readManifest = at => { try { const j = JSON.parse(readFileSync(join(at, MANIFEST), 'utf8')); return j && typeof j.files === 'object' ? j : { files: {} } } catch { return { files: {} } } }
// every file of the run's newest commit, with its content, read in one go (git cat-file --batch); links and
// repositories inside it are not files and are left out
async function filesOf(dir) {
  const t = await git(dir, ['ls-tree', '-r', '-z', 'HEAD'], GITHUB)
  if (!t.ok) throw fail(`Could not read the project's history: ${said(t.err)}`, 500)
  const rows = t.out.split('\0').filter(Boolean).map(r => { const [meta, path] = r.split('\t'); const [mode, type, sha] = meta.split(/\s+/); return { mode, type, sha, path } })
    .filter(r => r.type === 'blob' && r.mode !== '120000')
  if (rows.length > CAPS.files) throw fail(`More than ${CAPS.files.toLocaleString('en-US')} files: too many to write`, 413)
  const body = await new Promise((ok, no) => {
    const p = execFile('git', ['cat-file', '--batch'], { cwd: dir, maxBuffer: CAPS.bytes + 64e6, encoding: 'buffer', windowsHide: true }, (err, stdout) => (err ? no(err) : ok(stdout)))
    p.stdin.end(rows.map(r => r.sha).join('\n') + '\n')
  })
  let at = 0
  for (const r of rows) {
    const nl = body.indexOf(10, at)
    const size = Number(body.subarray(at, nl).toString().split(' ')[2])
    r.content = body.subarray(nl + 1, nl + 1 + size)
    at = nl + 1 + size + 1
  }
  return rows
}
const inside = (root, p) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep)

/** What writing the run's files into `target` would do: { add, update: files it wrote before and nobody changed,
 * theirs: files there it did not write (or someone changed since), remove: files it wrote before that the project
 * no longer has and nobody changed, keys: files that look like keys (never written) } */
export async function folderChanges({ dir, target }) {
  const files = await filesOf(dir)
  const had = readManifest(target).files
  const out = { add: [], update: [], same: [], theirs: [], remove: [], keys: [], files }
  const now = new Set()
  for (const f of files) {
    if (keyFile(f.path)) { out.keys.push(f.path); continue }
    now.add(f.path)
    const dest = join(target, f.path)
    if (!existsSync(dest)) { out.add.push(f.path); continue }
    const st = statSync(dest)
    if (!st.isFile()) { out.theirs.push(f.path); continue }
    const cur = blobId(readFileSync(dest))
    if (cur === f.sha) out.same.push(f.path)
    else if (had[f.path] === cur) out.update.push(f.path)
    else out.theirs.push(f.path)
  }
  for (const [path, sha] of Object.entries(had)) {
    if (now.has(path)) continue
    const dest = join(target, path)
    try { if (statSync(dest).isFile() && blobId(readFileSync(dest)) === sha) out.remove.push(path) } catch {}
  }
  return out
}

/** Write the run's files into `target` (made when it is not there). Files it did not write are overwritten only
 * with `confirm`; without it, the write stops first and says which (`changes`). Files it wrote and nobody changed
 * are updated, or removed when the project no longer has them. → { added, updated, overwrote, removed, same } */
export async function toFolder({ dir, folder, sub, confirm = false, step = () => {} }) {
  await saveChanges(dir, GITHUB, step)
  if (!(await localHead(dir))) throw fail('Nothing to write yet: this project has no history', 409)
  const target = resolve(folder, cleanName(sub))
  if (!inside(folder, target) || target === folder) throw fail('The subfolder has to stay inside the folder')
  if (existsSync(target)) {
    const real = realpathSync(target)
    if (!inside(realpathSync(folder), real) || !statSync(real).isDirectory()) throw fail(`${sub} in ${folder} is not a folder there`)
    if (existsSync(join(real, '.git'))) throw fail(`${sub} is a git checkout: name that folder itself, so this project goes to a branch of it`, 409)
  }
  step('comparing with what is there')
  const c = await folderChanges({ dir, target })
  if (c.keys.length) throw fail(`Not written. ${c.keys.length === 1 ? 'This file looks' : 'These files look'} like keys: ${c.keys.slice(0, 8).join(', ')}. Take ${c.keys.length === 1 ? 'it' : 'them'} out of the project first.`, 422, { keys: c.keys })
  if (c.theirs.length && !confirm) {
    throw fail(`${c.theirs.length} file${c.theirs.length === 1 ? '' : 's'} in ${target} ${c.theirs.length === 1 ? 'was' : 'were'} not written by this project, or changed since: ${c.theirs.slice(0, 6).join(', ')}${c.theirs.length > 6 ? ` and ${c.theirs.length - 6} more` : ''}. Nothing was written.`, 409,
      { changes: { folder: target, add: c.add.length, update: c.update.length, remove: c.remove.length, theirs: c.theirs.slice(0, 50), more: Math.max(0, c.theirs.length - 50) } })
  }
  step(`writing into ${target}`)
  const write = new Set([...c.add, ...c.update, ...c.theirs])
  const wrote = {}
  for (const f of c.files) {
    if (keyFile(f.path)) continue
    const dest = join(target, f.path)
    if (!inside(target, resolve(dest))) continue
    wrote[f.path] = f.sha
    if (!write.has(f.path)) continue
    mkdirSync(dirname(dest), { recursive: true })
    const tmp = `${dest}.swarm-tmp`
    writeFileSync(tmp, f.content)
    renameSync(tmp, dest)
  }
  for (const path of c.remove) rmSync(join(target, path), { force: true })
  // what it wrote, for the next time: a file whose content is still this one is the project's to update
  const tmp = join(target, `${MANIFEST}.tmp`)
  writeFileSync(tmp, JSON.stringify({ note: 'Written by Swarm Studio: the files it wrote here, so a later write updates only those', files: wrote }, null, 1))
  renameSync(tmp, join(target, MANIFEST))
  return { target, added: c.add.length, updated: c.update.length, overwrote: c.theirs.length, removed: c.remove.length, same: !c.add.length && !c.update.length && !c.theirs.length && !c.remove.length }
}

/** where a folder link is, said in a line */
export const folderWhere = l => (l.mode === 'checkout' ? `${l.folder}, branch ${l.branch}` : join(l.folder, l.sub))
