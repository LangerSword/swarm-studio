// A project's source on GitHub (docs/specs/45-intake.md, engine/sourcehub.mjs): the door inside a project.
//   GET  /api/projects/<id>/github[?run=&piece=&check=1]  -> what is true: linked or not, pushed or pulled when,
//        changes not pushed, and (with check=1, one request to GitHub) new commits to pull
//   POST /api/projects/<id>/github { action: 'push' | 'pull' | 'bring' | 'unlink', piece?, run?, repo?, public?, path?, kind? }
//        push   the run's history to its repository; the first one makes it (private unless public: true) from
//               `repo` as a name, or links `repo` as owner/name when that one is empty or already this project's.
//               One that holds other work is refused with `other` ({ repo, branch, files, bytes, bring }) unless
//               `mode` says what to do: 'branch' pushes to a new branch of it (with GitHub's page for a pull request),
//               'merge' brings its files in first (the Bring-in rules) and pushes on top. Never a force push.
//        pull   what is new in the linked repository (or the one it was brought in from), as the next version
//        bring  a repository into this project, when it has no app or game source yet
//        unlink forget which repository (or folder) this piece goes to; nothing on GitHub or on disk changes
//        push with `folder` (a path in the home folder; `sub` names a subfolder for a plain folder): the third way,
//               engine/sourcefolder.mjs. A git checkout gets this project's commits on a branch of its own (nothing
//               pushed); a plain folder gets the files in the subfolder, files it did not write refused with
//               `changes` unless `confirm: true`. Pull reads it back as the next version, as Bring in reads a folder.
//   GET  /api/github/repos              -> the repositories the person's gh login sees on their account and in their
//        organizations, newest first: { login, repos: [{ repo, private, empty, updated }], errors } (the sheet's
//        "An existing repository" list)
//   GET  /api/github/owner             -> where builds go on GitHub: { login, owner (null: the person's account),
//        orgs: [{ login, can, why }], error } (engine/ghowner.mjs; Settings › You › GitHub, "publish to <org>")
//   POST /api/github/owner { owner }   -> choose it: null or the login is the person's account; an organization must
//        be one of theirs where they may make repositories. Answers the same view, or the reason in words
// The answer comes at once with the job working; the sheet and the chat ask again until it is done. The person's
// own gh login does it; no token is read or kept. The hosted studio has no such door (server/hosted.mjs: 403).
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GITHUB, ghCli, ghLogin, listRepos, pushSource, remoteHead, localHead, hasCommit, isBehind, changedUnder, repoName, readTarget, sourceLinks, rememberLink } from '../engine/sourcehub.mjs'
import { parseRepo, cleanSub, KINDS } from '../engine/bringin.mjs'
import { chooseOwner, ghOrgs, ownerFor, ownerView, savedOwner } from '../engine/ghowner.mjs'
import { cleanName, folderChanges, folderTarget, folderWhere, freeLocalBranch, toCheckout, toFolder } from '../engine/sourcefolder.mjs'
import { git as gitIn } from '../engine/sourcehub.mjs'

// the plugin's own folder: never a place a project's source is written
const PLUGIN = fileURLToPath(new URL('..', import.meta.url))

const fail = (message, status = 400, more = {}) => Object.assign(new Error(message), { status, ...more })

export function sourceRoutes({ runsDir, dataDir, projects, readEvents, record, broadcast = () => {}, bringIn, working = async () => false, hub = GITHUB, gh = ghCli, now = () => Date.now(), home = homedir(), hermesHome = process.env.HERMES_HOME || join(homedir(), '.hermes') }) {
  // a folder a project's source may be written to: inside the home folder, and none of these
  const deny = [runsDir, dataDir, hermesHome, PLUGIN].filter(Boolean)
  const json = (res, code, data) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data))
  const jobs = new Map() // "<project>:<piece>" -> { did, state, step, message, repo, url, pull, keys, run, t }
  const appDir = run => join(runsDir, run, 'app')
  let who = null
  const login = async () => {
    if (who && now() - who.t < 60000 && who.login) return who.login
    who = { t: now(), login: await ghLogin(gh).catch(() => null) }
    return who.login
  }

  // the project, by its id or by one of its runs
  function projectFor(ref) {
    const id = String(ref || '')
    if (!/^[\w-]{1,64}$/.test(id)) throw fail('no such project', 404)
    const p = projects.get(id) || projects.get(projects.projectOf(id) || '')
    if (!p || p.trashed) throw fail('no such project', 404)
    return p
  }
  // the project's source: per piece (the app, the game), its newest run with a history of its own
  function sourcesOf(p) {
    const ids = [...new Set([...(p.versions || []).map(v => v.id), ...Object.keys(p.parts || {})])].sort()
    const out = new Map()
    for (const run of ids) {
      if (!existsSync(join(appDir(run), '.git'))) continue
      const start = (readEvents(run) || []).find(e => e.type === 'run:start')
      out.set(start?.kind === 'game' ? 'game' : 'app', { run, title: start?.title || p.name })
    }
    return out
  }
  // which piece is meant: the one asked for, the one the open run is, else the newest
  function pick(p, { run = '', piece = '' } = {}) {
    const srcs = sourcesOf(p)
    const byRun = [...srcs].find(([, s]) => s.run === run)?.[0]
    const kind = KINDS.includes(piece) && srcs.has(piece) ? piece : byRun || [...srcs].sort((a, b) => a[1].run.localeCompare(b[1].run)).at(-1)?.[0] || (KINDS.includes(piece) ? piece : 'app')
    return { srcs, piece: kind, src: srcs.get(kind) || null, key: `${p.id}:${kind}` }
  }
  // where a run was brought in from, when that is a GitHub repository
  function originOf(run) {
    const from = (readEvents(run) || []).findLast(e => e.type === 'intake')?.source
    const repo = from?.repo || from?.origin
    return repo ? { repo, path: from.path || '', sha: from.sha || null } : null
  }

  async function state(ref, ask = {}) {
    const p = projectFor(ref)
    const { srcs, piece, src, key } = pick(p, ask)
    const links = sourceLinks(dataDir)
    const link = links[key] || null, seen = links[`${key}:from`] || null
    const origin = src ? originOf(src.run) : null
    const local = src ? await localHead(appDir(src.run), hub) : null
    // a version that came in with a history of its own cannot go to a repository that holds another
    const fits = !link?.sha || !src || await hasCommit(appDir(src.run), link.sha, hub)
    let behind = null, unreachable = null
    if (ask.check && src && !link?.folder && (link || origin) && jobs.get(key)?.state !== 'working') {
      try {
        const r = await remoteHead((link || origin).repo, hub, { timeout: 12000 })
        behind = !r.sha ? false : link ? r.sha !== link.sha && !(await isBehind(appDir(src.run), r.sha, hub)) : r.sha !== (seen?.repo === origin.repo && seen.sha || origin.sha)
      } catch (err) { unreachable = String(err.message || err) }
    }
    return {
      project: p.id, name: p.name, piece, pieces: [...srcs.keys()], run: src?.run || null, source: !!src, login: await login(),
      // where a new repository would be made: the organization builds go to (Settings › You › GitHub), else null
      owner: savedOwner(dataDir),
      suggest: repoName(src?.title || p.name),
      link: link?.folder ? { repo: null, url: null, folder: link.folder, mode: link.mode, branch: link.branch || null, sub: link.sub || null, where: folderWhere(link), private: null, pushed: link.pushed || null, pulled: link.pulled || null, fits }
        : link ? { repo: link.repo, url: hub.page(link.repo), private: link.private !== false, branch: link.branch || null, base: link.base || null, pr: link.base && link.branch ? `${hub.page(link.repo)}/compare/${encodeURIComponent(link.base)}...${encodeURIComponent(link.branch)}?expand=1` : null, pushed: link.pushed || null, pulled: link.pulled || null, fits } : null,
      origin: origin ? { repo: origin.repo, path: origin.path, url: hub.page(origin.repo), pulled: seen?.pulled || null } : null,
      ahead: !!(link && fits && local && (local.dirty || local.sha !== link.sha)), behind, unreachable,
      job: jobs.get(key) || null
    }
  }

  // one job per piece: its steps are what the sheet and the chat show beside the crew's cursor
  function start(key, did, work) {
    const j = { did, state: 'working', step: '', message: '', t: now() }
    jobs.set(key, j)
    const say = () => broadcast({ type: 'source:job', t: now(), key, did, state: j.state, step: j.step })
    j.done = Promise.resolve().then(() => work(text => { j.step = String(text); say() })).then(out => { Object.assign(j, { state: 'done', step: '' }, out) }, err => {
      Object.assign(j, { state: 'failed', step: '', message: String(err.message || err).slice(0, 400), ...(err.pull ? { pull: true } : {}), ...(err.keys ? { keys: err.keys } : {}), ...(err.other ? { other: err.other } : {}), ...(err.changes ? { changes: err.changes } : {}) })
    }).then(say)
    say()
    return j
  }

  async function act(ref, input = {}) {
    const p = projectFor(ref)
    const { piece, src, key } = pick(p, input)
    if (jobs.get(key)?.state === 'working') return state(ref, input)
    const action = String(input.action || '')
    const link = sourceLinks(dataDir)[key] || null

    // the project forgets where this piece goes: the repository and the files stay as they are
    if (action === 'unlink') {
      if (!link) throw fail('This project is not linked to a repository', 409)
      rememberLink(dataDir, key, null)
      jobs.delete(key)
      return state(ref, input)
    }

    if (action === 'bring') {
      if (src) throw fail('This project already has its source. Pull brings in what is new.', 409)
      const repo = parseRepo(input.repo), path = cleanSub(input.path), kind = KINDS.includes(input.kind) ? input.kind : null
      if (!kind) throw fail('Game or App?')
      const k = `${p.id}:${kind}`
      let end = null
      const ended = new Promise((ok, no) => { end = err => (err ? no(err) : ok()) })
      ended.catch(() => {})
      const out = await bringIn({ repo: repo.slug, path, kind, name: p.name, project: p.id }, { onEnd: end })
      start(k, 'bring', async step => { step(`bringing in ${repo.slug}`); await ended; return { run: out.run, repo: repo.slug, url: hub.page(repo.slug), message: `Brought in from ${repo.slug}` } })
      return state(ref, { piece: kind })
    }

    if (!src) throw fail('This project has no app or game source yet', 409)
    const dir = appDir(src.run)
    if (await working(src.run)) throw fail('The crew is still working on it. Try again when they are done.', 409)

    if (action === 'push' && (input.folder || link?.folder)) {
      if (input.folder && link && !link.folder) throw fail(`This project goes to ${link.repo}. Unlink it first, to write it into a folder.`, 409)
      if (input.repo && !input.folder) throw fail(`This project goes to ${folderWhere(link)}. Unlink it first, to put it on GitHub.`, 409)
      const at = folderTarget(input.folder || link.folder, { home, deny })
      const mode = at.checkout ? 'checkout' : 'folder'
      const sub = mode === 'folder' ? cleanName(input.sub ?? link?.sub) : null
      start(key, 'push', async step => {
        if (mode === 'checkout') {
          const branch = link?.folder === at.folder && link.branch ? link.branch : await freeLocalBranch(at.folder, src.title)
          rememberLink(dataDir, key, { folder: at.folder, mode, branch, sub: null })
          const out = await toCheckout({ dir, folder: at.folder, branch, step })
          rememberLink(dataDir, key, { folder: at.folder, mode, branch, sha: out.sha, pushed: now() })
          if (!out.same) record(src.run, { type: 'source:write', t: now(), run: src.run, folder: at.folder, branch, sha: out.sha })
          return { folder: at.folder, message: out.same ? `Nothing new to write: ${branch} in ${at.folder} has it all` : `Written to the branch ${branch} in ${at.folder}. Nothing was pushed anywhere.` }
        }
        rememberLink(dataDir, key, { folder: at.folder, mode, sub, branch: null })
        const out = await toFolder({ dir, folder: at.folder, sub, confirm: input.confirm === true, step })
        rememberLink(dataDir, key, { folder: at.folder, mode, sub, sha: (await localHead(dir, hub))?.sha || null, pushed: now() })
        if (!out.same) record(src.run, { type: 'source:write', t: now(), run: src.run, folder: out.target })
        return { folder: out.target, message: out.same ? `Nothing new to write: ${out.target} has it all` : `Written into ${out.target}: ${[out.added && `${out.added} new`, out.updated && `${out.updated} updated`, out.overwrote && `${out.overwrote} replaced`, out.removed && `${out.removed} removed`].filter(Boolean).join(', ')}` }
      })
      return state(ref, input)
    }

    if (action === 'push') {
      const want = { ...readTarget(input.repo), public: input.public === true, mode: ['branch', 'merge'].includes(input.mode) ? input.mode : undefined }
      const fits = !link?.sha || await hasCommit(dir, link.sha, hub)
      if (link && !fits && !want.repo && !want.name) throw fail(`This version does not continue ${link.repo}, so it cannot go there. Give it a repository of its own.`, 409)
      start(key, 'push', async step => {
        const out = await pushSource({ dir, link, want, title: src.title, hub, gh, step, ownerOf: async () => (await ownerFor(dataDir, gh)).owner,
          onLink: l => rememberLink(dataDir, key, { repo: l.repo, private: l.private, branch: l.branch, base: l.base || null, made: l.made }) })
        rememberLink(dataDir, key, { repo: out.repo, sha: out.sha, pushed: now() })
        if (!out.same) record(src.run, { type: 'source:push', t: now(), run: src.run, repo: out.repo, sha: out.sha, private: out.private })
        const where = out.base ? `the branch ${out.branch} of ${out.repo}` : out.repo
        return { repo: out.repo, url: out.url, private: out.private, pr: out.pr, message: out.same ? `Nothing new to push: ${where} has it all` : want.mode === 'merge' ? `Brought in ${out.repo}'s files and pushed on top` : `Pushed to ${where}` }
      })
      return state(ref, input)
    }

    if (action === 'pull' && link?.folder) {
      const at = folderTarget(link.folder, { home, deny })
      start(key, 'pull', async step => {
        let from = at.folder
        if (link.mode === 'checkout') {
          // what is read is the checkout's working tree: the branch the project went to has to be the one out there
          const out = await gitIn(at.folder, ['-c', 'core.fsmonitor=false', 'symbolic-ref', '-q', '--short', 'HEAD'], hub)
          if (!out.ok || out.out.trim() !== link.branch) throw fail(`Check out ${link.branch} in ${at.folder} to pull it from there`, 409)
          const tip = await gitIn(at.folder, ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'], hub)
          const st = await gitIn(at.folder, ['-c', 'core.fsmonitor=false', 'status', '--porcelain'], hub)
          if (tip.ok && tip.out.trim() === link.sha && st.ok && !st.out.trim()) return { folder: at.folder, message: `Nothing new on ${link.branch} in ${at.folder}` }
        } else {
          from = join(at.folder, link.sub)
          const c = await folderChanges({ dir, target: from }).catch(() => null)
          if (c && !c.theirs.length && !c.add.length && !c.update.length) return { folder: from, message: `Nothing new in ${from}` }
        }
        step(`reading ${from}`)
        let end = null
        const ended = new Promise((ok, no) => { end = err => (err ? no(err) : ok()) })
        ended.catch(() => {})
        const out = await bringIn({ folder: at.folder, path: link.mode === 'checkout' ? '' : link.sub, kind: piece, name: src.title, project: p.id }, { onEnd: end })
        await ended
        rememberLink(dataDir, key, { folder: at.folder, pulled: now() })
        record(out.run, { type: 'source:pull', t: now(), run: out.run, folder: from, from: src.run })
        return { run: out.run, folder: from, message: `Pulled from ${from}: it is the project's newest version` }
      })
      return state(ref, input)
    }

    if (action === 'pull') {
      const origin = originOf(src.run)
      const from = link ? { repo: link.repo, path: '' } : origin
      if (!from) throw fail('This project is not linked to a repository yet', 409)
      const slug = parseRepo(from.repo).slug, path = cleanSub(from.path)
      start(key, 'pull', async step => {
        step(`checking ${slug}`)
        const seen = sourceLinks(dataDir)[`${key}:from`]
        const known = link ? link.sha : (seen?.repo === slug && seen.sha) || origin.sha
        const r = await remoteHead(slug, hub)
        const nothing = { repo: slug, url: hub.page(slug), message: `Nothing new on ${slug}` }
        if (!r.sha || r.sha === known || (link && await isBehind(dir, r.sha, hub))) return nothing
        if (!link && path && await changedUnder(slug, known, r.sha, path, gh) === false) {
          rememberLink(dataDir, `${key}:from`, { repo: slug, sha: r.sha })
          return { ...nothing, message: `Nothing new in ${path} on ${slug}` }
        }
        step(`pulling from ${slug}`)
        let end = null
        const ended = new Promise((ok, no) => { end = err => (err ? no(err) : ok()) })
        ended.catch(() => {})
        const out = await bringIn({ repo: slug, path, kind: piece, name: src.title, project: p.id }, { onEnd: end })
        await ended
        const got = originOf(out.run)
        if (link) rememberLink(dataDir, key, { repo: slug, sha: got?.sha || r.sha, pulled: now() })
        else rememberLink(dataDir, `${key}:from`, { repo: slug, sha: got?.sha || r.sha, pulled: now() })
        record(out.run, { type: 'source:pull', t: now(), run: out.run, repo: slug, sha: got?.sha || r.sha, from: src.run })
        return { run: out.run, repo: slug, url: hub.page(slug), message: `Pulled from ${slug}: it is the project's newest version` }
      })
      return state(ref, input)
    }
    throw fail('push, pull or bring')
  }

  function handle(req, res, url) {
    if (url.pathname === '/api/github/owner') return ownerRoute(req, res)
    if (url.pathname === '/api/github/repos') return reposRoute(req, res)
    const m = url.pathname.match(/^\/api\/projects\/([^/]+)\/github$/)
    if (!m) return false
    const say = err => json(res, err.status || 400, { error: String(err.message || err), ...(err.pull ? { pull: true } : {}), ...(err.keys ? { keys: err.keys } : {}), ...(err.changes ? { changes: err.changes } : {}) })
    const view = st => ({ ...st, job: st.job ? { ...st.job, done: undefined } : null })
    if (req.method === 'GET') {
      state(decodeURIComponent(m[1]), { run: url.searchParams.get('run') || '', piece: url.searchParams.get('piece') || '', check: url.searchParams.get('check') === '1' }).then(st => json(res, 200, view(st)), say)
      return true
    }
    if (req.method !== 'POST') return false
    let body = ''
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy() })
    req.on('end', () => {
      let input = {}
      try { input = JSON.parse(body || '{}') } catch {}
      act(decodeURIComponent(m[1]), input && typeof input === 'object' ? input : {}).then(st => json(res, 200, view(st)), say)
    })
    return true
  }
  // the repositories the person can link: their account's and their organizations' (any they belong to: linking needs
  // no right to make repositories, and GitHub itself refuses a push the login may not make)
  function reposRoute(req, res) {
    if (req.method !== 'GET') return false
    ;(async () => {
      const me = await login()
      if (!me) return json(res, 424, { error: 'GitHub CLI is not signed in: run gh auth login' })
      const orgs = await ghOrgs(gh).then(o => o.orgs.map(x => x.login), () => [])
      const got = await listRepos([me, ...orgs], gh)
      json(res, 200, { login: me, ...got })
    })().catch(err => json(res, err.status || 502, { error: String(err.message || err) }))
    return true
  }
  // where builds go on GitHub: the person's account or one of their organizations
  function ownerRoute(req, res) {
    if (req.method === 'GET') { ownerView(dataDir, gh).then(v => json(res, 200, v)); return true }
    if (req.method !== 'POST') return false
    let body = ''
    req.on('data', c => { body += c; if (body.length > 1e3) req.destroy() })
    req.on('end', () => {
      let input = {}
      try { input = JSON.parse(body || '{}') } catch {}
      chooseOwner(dataDir, input?.owner ?? null, gh).then(() => ownerView(dataDir, gh)).then(v => json(res, 200, v), err => json(res, err.status || 400, { error: String(err.message || err) }))
    })
    return true
  }
  return Object.assign(handle, { state, act, jobs, busy: () => [...jobs.values()].some(j => j.state === 'working') })
}
