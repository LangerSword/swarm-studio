// A project's source on GitHub (docs/specs/45-intake.md, "The other direction"): the run's own git history
// (runs/<id>/app/.git, a commit per change) pushed to a repository under the person's own `gh` login, and what
// is new there brought back. A new repository is made where builds go: the person's account, or the organization
// they chose (engine/ghowner.mjs). This file is the parts with no server in them.
//   Never a force push. Never a repository the Studio did not make or the person did not name. A file that
//   looks like a key anywhere in the commits being sent stops the push, with its name.
// git and gh run through engine/proc.mjs (a minimal environment), with no prompt, no hook, and the person's gh
// login as the only credential helper. `hub` (the address of a repository) and `gh` are parameters so the
// tests can stand a local bare repository in for GitHub; nothing but a test passes them.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from './proc.mjs'
import { parseRepo, CAPS } from './bringin.mjs'

const fail = (message, status = 400, more = {}) => Object.assign(new Error(message), { status, ...more })
const MARK = 'made with Swarm Studio'
const SIGN_IN = 'GitHub CLI is not signed in: run gh auth login'

/** the real GitHub: https only, and git may never read a repository from a file path */
export const GITHUB = { url: slug => `https://github.com/${slug}.git`, page: slug => `https://github.com/${slug}`, file: false }

const exec = (cmd, args, { cwd, timeout = 120000 } = {}) => new Promise(ok => {
  execFile(cmd, args, { cwd, timeout, maxBuffer: 64e6, windowsHide: true, env: { GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1' } },
    (err, stdout, stderr) => ok({ ok: !err, out: String(stdout || ''), err: err?.killed ? 'it took too long and was stopped' : String(stderr || err?.message || '') }))
})
/** gh, as the person: → { ok, out, err } */
export const ghCli = (args, opts) => exec('gh', args, { timeout: 30000, ...opts })
// git in the run's own folder: no hook of the project's runs, nothing is asked, the gh login answers for GitHub
export const git = (dir, args, hub = GITHUB, opts) => exec('git', ['-c', 'core.hooksPath=', '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', '-c', `protocol.file.allow=${hub.file ? 'always' : 'never'}`,
  '-c', 'user.name=Swarm Studio', '-c', 'user.email=swarm@localhost', ...args], { cwd: dir, ...opts })
// git's own last words, without any name and password in an address
const said = text => String(text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(-2).join(' ').replace(/https:\/\/[^@\s/]+@/g, 'https://').slice(0, 240)

// ---------- files that hold keys
// Intake never copies these (engine/bringin.mjs SKIP: .env, .env.*, .npmrc); a push also refuses key files by
// their endings. A file kept as an example (.env.example) is not one.
const KEY_FILE = /^(\.env|\.env\..+|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)|.+\.(pem|key|p12|pfx|jks|keystore))$/i
const KEY_KEPT = /^\.env\.(example|sample|template)$/i
/** does this path name a file that holds keys? */
export const keyFile = path => { const n = String(path).split('/').pop() || ''; return KEY_FILE.test(n) && !KEY_KEPT.test(n) }

// Untracked build output and key files never get into a commit the Studio makes before a push (the app
// scaffold's own .gitignore covers node_modules and dist, not .env). Written to .git/info/exclude, so no file
// of the project changes.
// The key names here are KEY_FILE's, as git patterns; what slips past them (another spelling) is caught by name
// before the commit is made (pushSource), so a key file never enters the history by the Studio's own hand.
const EXCLUDE = ['node_modules/', '.output/', '.nitro/', '.next/', '.vite/', '.vercel/', '.dyad/', '.turbo/', '.cache/', '.parcel-cache/', '.godot/', '.import/', '.DS_Store', 'Thumbs.db', '.swarm-built.json',
  '.env', '.env.*', '!.env.example', '!.env.sample', '!.env.template', '.npmrc', '.netrc', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore']
const EXCLUDE_MARK = '# swarm studio: never committed before a push'
function exclude(dir) {
  const f = join(dir, '.git', 'info', 'exclude')
  let text = ''
  try { text = readFileSync(f, 'utf8') } catch {}
  // the Studio's own lines are written again each time (the list may have grown); the project's own stay
  const own = text.split(EXCLUDE_MARK)[0].replace(/\n*$/, '\n')
  mkdirSync(join(dir, '.git', 'info'), { recursive: true })
  writeFileSync(f, `${own === '\n' ? '' : own}${EXCLUDE_MARK}\n${EXCLUDE.join('\n')}\n`)
}
const keysSay = keys => `Not pushed. ${keys.length === 1 ? 'This file looks' : 'These files look'} like keys: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ` and ${keys.length - 8} more` : ''}. Take ${keys.length === 1 ? 'it' : 'them'} out of the project first.`

/** Every key file named in the commits of `range` ('HEAD', or '<sha>..HEAD'): the whole history that would go
 * up, not only the newest files (a .env committed once and deleted later is still in it). → paths */
export async function keyFilesIn(dir, range = 'HEAD', hub = GITHUB) {
  const r = await git(dir, ['rev-list', '--objects', range, '--'], hub)
  if (!r.ok) throw fail(`Could not read the project's history: ${said(r.err)}`, 500)
  const out = new Set()
  for (const l of r.out.split('\n')) { const p = l.slice(l.indexOf(' ') + 1); if (l.includes(' ') && keyFile(p)) out.add(p) }
  return [...out].sort()
}

// ---------- what is where
/** The run's own history: its newest commit and whether files have changed since. null: no history there. */
export async function localHead(dir, hub = GITHUB) {
  if (!existsSync(join(dir, '.git'))) return null
  const head = await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'], hub)
  if (!head.ok) return null
  const st = await git(dir, ['status', '--porcelain'], hub)
  return { sha: head.out.trim(), dirty: st.ok && !!st.out.trim() }
}
/** does the run's history hold this commit? */
export const hasCommit = async (dir, sha, hub = GITHUB) => !!sha && (await git(dir, ['cat-file', '-e', `${sha}^{commit}`], hub)).ok
/** is `sha` this history's newest commit or one before it? (a commit the history lacks is not) */
export const isBehind = async (dir, sha, hub = GITHUB) => (await hasCommit(dir, sha, hub)) && (await git(dir, ['merge-base', '--is-ancestor', sha, 'HEAD'], hub)).ok

/** The repository's newest commit and its branch, asked of the remote (one request, nothing is fetched).
 * → { sha: null, branch: 'main' } for an empty one; throws in words when it cannot be reached */
export async function remoteHead(slug, hub = GITHUB, { timeout = 20000, branch = null } = {}) {
  const r = await git(undefined, ['ls-remote', '--symref', '--', hub.url(slug), branch ? `refs/heads/${branch}` : 'HEAD'], hub, { timeout })
  if (!r.ok) {
    if (/ENOENT/.test(r.err)) throw fail('git is not installed on this computer', 424)
    if (/not found|Authentication|could not read|denied|403|404/i.test(r.err)) throw fail(`GitHub would not give ${slug}. If it is private, sign in first: gh auth login`, 424)
    throw fail(`Could not reach ${slug}: ${said(r.err) || 'git stopped'}`, 502)
  }
  if (branch) return { sha: r.out.match(/^([0-9a-f]{40,64})\s+refs\/heads\//m)?.[1] || null, branch }
  const head = r.out.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m)?.[1] || 'main'
  const sha = r.out.match(/^([0-9a-f]{40,64})\s+HEAD$/m)?.[1] || null
  return { sha, branch: head }
}

// ---------- a repository that already holds other work
// It is never overwritten and never force-pushed. The person chooses: this project goes to a NEW BRANCH there (and
// GitHub's own page opens a pull request from it), or its files COME IN FIRST and this project is pushed on top.
/** a branch name the repository does not have yet: swarm/<name>, else swarm/<name>-2, -3 … */
async function freeBranch(slug, want, hub = GITHUB) {
  const r = await git(undefined, ['ls-remote', '--heads', '--', hub.url(slug)], hub, { timeout: 20000 })
  if (!r.ok) throw fail(`Could not read the branches of ${slug}: ${said(r.err) || 'git stopped'}`, 502)
  const have = new Set(r.out.split('\n').map(l => l.split('refs/heads/')[1]).filter(Boolean))
  for (let n = 1; n < 50; n++) { const b = n === 1 ? want : `${want}-${n}`; if (!have.has(b)) return b }
  throw fail(`${slug} has too many branches named ${want}`, 409)
}
/** What is on the repository's branch, fetched into the project's own git (its newest commit only; nothing is
 * checked out, nothing runs): how many files, how big, and whether they may come in under the Bring-in rules
 * (files only: no links, no submodules; no key files; at most CAPS). → { repo, branch, files, bytes, bring: null
 * or the reason they may not } */
export async function otherWork(dir, slug, branch, hub = GITHUB) {
  const f = await git(dir, ['fetch', '--quiet', '--depth', '1', '--no-tags', '--no-recurse-submodules', '--', hub.url(slug), `refs/heads/${branch}`], hub, { timeout: 180000 })
  if (!f.ok) throw fail(`Could not read ${slug}: ${said(f.err) || 'git stopped'}`, 502)
  const t = await git(dir, ['ls-tree', '-r', '-l', '-z', 'FETCH_HEAD'], hub)
  if (!t.ok) throw fail(`Could not read ${slug}: ${said(t.err)}`, 502)
  let files = 0, bytes = 0
  const links = [], modules = [], keys = []
  for (const row of t.out.split('\0').filter(Boolean)) {
    const [meta, path] = row.split('\t')
    const [mode, , , size] = meta.split(/\s+/)
    if (mode === '120000') links.push(path)
    else if (mode === '160000') modules.push(path)
    else { files++; bytes += Number(size) || 0; if (keyFile(path)) keys.push(path) }
  }
  const list = a => `${a.slice(0, 4).join(', ')}${a.length > 4 ? ` and ${a.length - 4} more` : ''}`
  const bring = keys.length ? `it holds files that look like keys (${list(keys)})`
    : links.length ? `it holds links to other places (${list(links)})`
    : modules.length ? `it holds other repositories inside it (${list(modules)})`
    : files > CAPS.files ? `it has more than ${CAPS.files.toLocaleString('en-US')} files`
    : bytes > CAPS.bytes ? `it is more than ${Math.round(CAPS.bytes / 1048576)} MB` : null
  return { repo: slug, branch, files, bytes, bring }
}
/** Bring the branch's files into the project's history (fetched by otherWork just before), this project's files
 * kept where both have one: a merge commit whose parents are this project's newest and the repository's, so the
 * push that follows is an ordinary one. Their history stays as it was. A merge git cannot finish is undone. */
async function bringOnTop(dir, other, hub = GITHUB) {
  if (other.bring) throw fail(`${other.repo}'s files can't come in: ${other.bring}. Push this project to a new branch there instead.`, 409)
  const m = await git(dir, ['merge', '--quiet', '--no-ff', '--allow-unrelated-histories', '-X', 'ours', '-m', `Brought in ${other.repo} (${other.branch}) before this project was pushed there`, 'FETCH_HEAD'], hub, { timeout: 300000 })
  if (!m.ok) {
    await git(dir, ['merge', '--abort'], hub)
    throw fail(`${other.repo}'s files could not be brought in: ${said(m.err) || 'git stopped'}. Nothing was changed. Push this project to a new branch there instead.`, 409)
  }
}

/** who is signed in to gh, or null */
export async function ghLogin(gh = ghCli) {
  const r = await gh(['api', 'user', '--jq', '.login'])
  const login = r.ok ? r.out.trim() : ''
  return /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null
}
/** a repository as the person's login sees it: { private, mine: the Studio made it } or null when there is none */
async function repoFacts(slug, gh = ghCli) {
  const r = await gh(['repo', 'view', slug, '--json', 'isPrivate,description'])
  if (!r.ok) {
    if (/404|Not Found|Could not resolve to a Repository/i.test(r.err + r.out)) return null
    throw fail(/ENOENT/.test(r.err) ? 'The GitHub CLI (gh) is not installed on this computer' : `GitHub did not answer for ${slug}: ${said(r.err)}`, 502)
  }
  let got = {}
  try { got = JSON.parse(r.out) || {} } catch {}
  return { private: got.isPrivate === true, mine: String(got.description || '').includes(MARK) }
}
/** The same list through GitHub's own MCP server, when the person added it to Hermes and granted it to this plugin
 * (engine/hermes_connect.mjs; Hermes holds the token). Its `search_repositories` tool takes a GitHub search query.
 * → the same shape as listRepos, or null when it gave nothing to read (the caller then asks gh) */
export async function listReposByConnector(owners, call) {
  const repos = [], errors = []
  for (const owner of [...new Set(owners.filter(o => /^[A-Za-z0-9-]{1,39}$/.test(String(o || ''))))]) {
    let got
    try { got = await call('github', 'search_repositories', { query: `user:${owner} fork:true`, perPage: 100 }) } catch (err) { errors.push(`${owner}: ${String(err.message || err).slice(0, 200)}`); continue }
    const items = Array.isArray(got?.items) ? got.items : Array.isArray(got) ? got : null
    if (!items) return null
    for (const x of items) {
      const name = x?.full_name || x?.nameWithOwner
      if (typeof name !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(name)) continue
      repos.push({ repo: name, private: x.private === true, empty: x.size === 0, updated: Date.parse(x.pushed_at || x.updated_at) || 0 })
    }
  }
  repos.sort((a, b) => b.updated - a.updated || a.repo.localeCompare(b.repo))
  return { repos, errors, by: 'connector' }
}

/** The repositories the person's gh login can see under each of `owners` (their login, their organizations), the
 * newest first, for the sheet's "An existing repository" list. One owner GitHub would not list is said in `errors`
 * and the others still come back. → { repos: [{ repo, private, empty, updated }], errors: [words] } */
export async function listRepos(owners, gh = ghCli) {
  const repos = [], errors = []
  for (const owner of [...new Set(owners.filter(o => /^[A-Za-z0-9-]{1,39}$/.test(String(o || ''))))]) {
    const r = await gh(['repo', 'list', owner, '--limit', '200', '--json', 'nameWithOwner,isPrivate,isEmpty,updatedAt'])
    if (!r.ok) {
      if (/ENOENT/.test(r.err)) throw fail('The GitHub CLI (gh) is not installed on this computer', 424)
      errors.push(`${owner}: ${said(r.err) || 'GitHub did not list it'}`)
      continue
    }
    let got = []
    try { got = JSON.parse(r.out) } catch {}
    for (const x of Array.isArray(got) ? got : []) {
      if (typeof x?.nameWithOwner !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(x.nameWithOwner)) continue
      repos.push({ repo: x.nameWithOwner, private: x.isPrivate === true, empty: x.isEmpty === true, updated: Date.parse(x.updatedAt) || 0 })
    }
  }
  repos.sort((a, b) => b.updated - a.updated || a.repo.localeCompare(b.repo))
  return { repos, errors }
}

/** Did anything under `path` change between two commits of the repository? → true, false, or null (GitHub
 * would not say: more than it lists, or no answer) */
export async function changedUnder(slug, from, to, path, gh = ghCli) {
  if (!path) return true
  if (!from || !to) return null
  const r = await gh(['api', `repos/${slug}/compare/${from}...${to}`, '--jq', '[(.files | length), (.files[].filename)] | @json'])
  if (!r.ok) return null
  let got = []
  try { got = JSON.parse(r.out) } catch { return null }
  if (!Array.isArray(got) || typeof got[0] !== 'number' || got[0] >= 300) return null
  return got.slice(1).some(f => String(f).startsWith(`${path}/`))
}

/** a repository's name from a project's: "Night Runner!" → "night-runner" */
export const repoName = title => String(title || '').normalize('NFKD').replace(/[^\w\s.-]+/g, '').trim().toLowerCase().replace(/[\s_.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project'

/** What the person typed in the sheet's Repository field: "owner/name" (or its https address) names one that
 * exists; a bare name is a new one where builds go (their login, or their chosen organization). → { repo } or { name } */
export function readTarget(given) {
  const s = String(given ?? '').trim()
  if (!s) return {}
  if (s.includes('/')) return { repo: parseRepo(s).slug }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(s) || s.startsWith('-') || s === '.' || s === '..') throw fail('A repository name is letters, numbers, dots and dashes')
  return { name: s }
}

// ---------- push
/** What changed since the run's last commit goes into one more (the crew commits each change; a hand edit may not
 * be), before its history goes anywhere: a key file among the changes stops it, the changes put back as they were. */
export async function saveChanges(dir, hub = GITHUB, step = () => {}) {
  exclude(dir)
  if ((await localHead(dir, hub))?.dirty) {
    step('saving the latest changes')
    await git(dir, ['add', '-A'], hub)
    // a key file among them (a name the patterns above missed, or one already tracked and changed) is never
    // committed by the Studio: the changes are put back as they were, and the push stops with the names
    const staged = (await git(dir, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], hub)).out.split('\n').filter(Boolean).filter(keyFile)
    if (staged.length) { await git(dir, ['reset', '-q'], hub); throw fail(keysSay(staged), 422, { keys: staged }) }
    await git(dir, ['commit', '-qm', 'Changes made in Swarm Studio'], hub)
  }
}

/**
 * Push the run's history. `link` is the repository this project already goes to ({ repo, branch }), if any;
 * `want` is what the person asked for when there is none (or to change it): { repo: 'owner/name' } links one
 * that exists, { name } makes a new one, `public: true` makes it public (private otherwise).
 *   - a new repository is made only when the name is free; one that exists is never taken over
 *   - a named repository is linked only when it is empty or its newest commit is already in this history
 *   - the remote having commits this history lacks is refused, with `pull: true`
 *   - a key file in the commits being sent is refused, with the names in `keys`
 * `onLink(link)` is called as soon as the repository is known (before the push), so a push that fails goes back
 * to the same one. `ownerOf(login)` says where a new repository is made (engine/ghowner.mjs ownerFor: the login,
 * or the chosen organization); it is asked only when one is about to be made, so a linked project never waits on it.
 * → { repo, url, private, branch, sha, made, fresh, same: nothing new to send }
 */
export async function pushSource({ dir, link = null, want = {}, title = '', hub = GITHUB, gh = ghCli, step = () => {}, onLink = () => {}, ownerOf = async login => login }) {
  const login = await ghLogin(gh)
  if (!login) throw fail(SIGN_IN, 424)
  if (!existsSync(join(dir, '.git'))) throw fail('Nothing to push yet: this project has no source', 409)
  await saveChanges(dir, hub, step)
  const local = await localHead(dir, hub)
  if (!local) throw fail('Nothing to push yet: this project has no history', 409)

  const named = want.repo ? parseRepo(want.repo).slug : null
  const fresh = !named && (want.name || !link)
  let slug = named || (fresh ? `${await ownerOf(login)}/${readTarget(want.name || repoName(title)).name}` : link.repo)
  step(`checking ${slug}`)
  let facts = await repoFacts(slug, gh)
  // no name was given and the project's own is taken (Publish › Website makes <owner>/<name> for the site's
  // pages): the next free one, <name>-source first. One that exists is never taken over.
  if (fresh && facts && !want.name) {
    for (const cand of ['source', ...[2, 3, 4, 5].map(n => `source-${n}`)].map(s => `${slug}-${s}`)) {
      if (!(await repoFacts(cand, gh))) { slug = cand; facts = null; break }
    }
  }
  if (fresh && facts) throw fail(`${slug} is already on GitHub. Give another name.`, 409)
  if (!fresh && !facts) throw fail(`No repository ${slug} that your GitHub login can reach`, 404)
  let remote = { sha: null, branch: 'main', base: null }
  // a project linked to a branch of its own (made because the repository held other work) goes on to that branch
  const own = !fresh && link && link.repo === slug && link.base && link.branch ? link : null
  if (own) {
    const b = await remoteHead(slug, hub, { branch: own.branch })
    remote = { sha: b.sha, branch: own.branch, base: own.base }
    if (b.sha && !(await isBehind(dir, b.sha, hub))) throw fail(`${slug} has commits on ${own.branch} this project does not have. Pull them first.`, 409, { pull: true })
  } else if (!fresh) {
    remote = { ...await remoteHead(slug, hub), base: null }
    if (remote.sha && !(await isBehind(dir, remote.sha, hub))) {
      if (link && link.repo === slug) throw fail(`${slug} has commits this project does not have. Pull them first.`, 409, { pull: true })
      if (want.mode === 'branch') {
        // a branch of its own: the repository's branches are left as they are
        remote = { sha: null, branch: await freeBranch(slug, `swarm/${repoName(title)}`, hub), base: remote.branch }
        step(`pushing to a new branch, ${remote.branch}`)
      } else {
        step(`reading what ${slug} holds`)
        const other = await otherWork(dir, slug, remote.branch, hub)
        if (want.mode !== 'merge') {
          throw fail(`${slug} already holds other work on ${remote.branch} (${other.files} file${other.files === 1 ? '' : 's'}). Nothing was changed. Push this project to a new branch there${other.bring ? '' : ', or bring its files in first and push on top'}.`, 409, { other })
        }
        step(`bringing in ${slug}`)
        await bringOnTop(dir, other, hub)
      }
    }
  }
  const keys = await keyFilesIn(dir, remote.sha ? `${remote.sha}..HEAD` : 'HEAD', hub)
  if (keys.length) throw fail(keysSay(keys), 422, { keys })
  const head = await localHead(dir, hub)

  const isPrivate = fresh ? !want.public : facts.private
  if (fresh) {
    step(`making ${slug}`)
    const made = await gh(['repo', 'create', slug, isPrivate ? '--private' : '--public', '--description', `${title || slug.split('/')[1]} · ${MARK}`.slice(0, 340)])
    if (!made.ok) throw fail(`GitHub would not make ${slug}: ${said(made.err)}`, 502)
  }
  // a branch of its own carries the branch it came from: GitHub's page for a pull request from it into that one
  const pr = remote.base ? `${hub.page(slug)}/compare/${encodeURIComponent(remote.base)}...${encodeURIComponent(remote.branch)}?expand=1` : null
  const out = { repo: slug, url: hub.page(slug), private: isPrivate, branch: remote.branch, base: remote.base || null, pr, made: fresh ? true : !!(link && link.repo === slug && link.made), fresh: !!fresh }
  onLink(out)
  if (remote.sha === head.sha) return { ...out, sha: head.sha, same: true }
  step(`pushing to ${slug}`)
  // by address and branch, never a remote kept in the project's own git config, and never with --force
  const p = await git(dir, ['push', '--quiet', '--', hub.url(slug), `HEAD:refs/heads/${remote.branch}`], hub, { timeout: 1800000 })
  if (!p.ok) {
    if (/non-fast-forward|fetch first|\[rejected\]/i.test(p.err)) throw fail(`${slug} has commits this project does not have. Pull them first.`, 409, { pull: true })
    if (/Authentication|could not read Username|denied|403/i.test(p.err)) throw fail(`GitHub would not take the push to ${slug}. ${SIGN_IN.split(': ')[1]}, with a login that may write there`, 424)
    throw fail(`Could not push to ${slug}: ${said(p.err) || 'git stopped'}`, 502)
  }
  return { ...out, sha: head.sha, same: false }
}

// ---------- pull
/** A run just brought in from the whole of a repository continues that repository's history when its files
 * are exactly the repository's (nothing was left out on the way in): its newest commit is fetched alone and the
 * run's history starts from it, so a later push is an ordinary one. → the commit, or null (the run then starts
 * its own history, and cannot be pushed to that repository). Runs nothing of the project. */
export async function joinHistory(dir, slug, hub = GITHUB) {
  const undo = () => { rmSync(join(dir, '.git'), { recursive: true, force: true, maxRetries: 3 }); return null }
  if (existsSync(join(dir, '.git'))) return null
  if (!(await git(dir, ['init', '-q'], hub)).ok) return undo()
  const f = await git(dir, ['fetch', '--quiet', '--depth', '1', '--no-tags', '--no-recurse-submodules', '--', hub.url(slug), 'HEAD'], hub, { timeout: 180000 })
  if (!f.ok) return undo()
  if (!(await git(dir, ['reset', '-q', 'FETCH_HEAD'], hub)).ok) return undo()
  const st = await git(dir, ['status', '--porcelain'], hub)
  if (!st.ok || st.out.trim()) return undo()
  const head = await git(dir, ['rev-parse', 'HEAD'], hub)
  return head.ok ? head.out.trim() : undo()
}

// ---------- what a project remembers: its repository, per piece (the app or the game), in the Studio's data folder
const storeFile = dataDir => join(dataDir, 'github-source.json')
export function sourceLinks(dataDir) {
  try { const all = JSON.parse(readFileSync(storeFile(dataDir), 'utf8')); return all && typeof all === 'object' ? all : {} } catch { return {} }
}
/** remember (or with null, forget) what `key` ("<project>:<piece>") is linked to; fields given are merged in */
export function rememberLink(dataDir, key, link) {
  const all = sourceLinks(dataDir)
  if (link) all[key] = { ...(all[key]?.repo === link.repo ? all[key] : {}), ...link }
  else delete all[key]
  mkdirSync(dataDir, { recursive: true })
  const tmp = `${storeFile(dataDir)}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 1))
  renameSync(tmp, storeFile(dataDir))
  return all[key] || null
}
