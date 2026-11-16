// @ts-check
// A project's source on GitHub (docs/specs/45-intake.md, "The other direction"): one entry, GitHub, in a
// project's menu and on its card's menu, opens one small sheet. It says what is true (not linked, linked to
// owner/name, private or public, pushed or pulled when, changes not pushed, new commits to pull) and has the
// two moves: Push and Pull. A project with no app or game yet brings a repository in from here. The same
// moves typed in the chat: "push to github", "pull from github", "link owner/name", "where is this on github". And
// where builds go (the person's account or an organization): "publish to <organization>", "where do builds go".
// Anything on its way shows a crew cursor with what it is doing. The server does the work (server/sourcehub.mjs)
// with the person's own gh login; the hosted studio has no such door.
// Imports only the icons, so node tests the words; the canvas hands it what it needs (web/canvas/loop.js).
import { cursor, CREW } from './icons.js'

/**
 * @typedef {object} GitHubState
 * @property {string} project @property {string} name @property {string} piece @property {string[]} pieces
 * @property {string | null} run @property {boolean} source @property {string | null} login @property {string} suggest
 * @property {string | null} [owner] the organization a new repository goes to (null: the person's account)
 * @property {{ repo: string | null, url: string | null, private: boolean | null, branch?: string | null, base?: string | null, pr?: string | null, folder?: string | null, mode?: string | null, sub?: string | null, where?: string | null, pushed: number | null, pulled: number | null, fits: boolean } | null} link
 * @property {{ repo: string, path: string, url: string, pulled: number | null } | null} origin
 * @property {boolean} ahead @property {boolean | null} behind @property {string | null} unreachable
 * @property {{ did: string, state: string, step: string, message: string, url?: string, repo?: string, pull?: boolean, run?: string, pr?: string | null, other?: GitHubOther, changes?: GitHubChanges, folder?: string } | null} job
 */
/**
 * @typedef {object} GitHubOther a repository that already holds other work: what it holds, and whether its files may come in
 * @property {string} repo @property {string} branch @property {number} files @property {number} bytes @property {string | null} bring
 */
/**
 * @typedef {object} GitHubChanges a write into a folder that would replace files the project did not write
 * @property {string} folder @property {number} add @property {number} update @property {number} remove @property {string[]} theirs @property {number} more
 */
/**
 * @typedef {object} GitHubHost
 * @property {(path: string, opts?: any) => Promise<Response>} api
 * @property {(s: string) => string} esc
 * @property {() => string | null} project the open project (or its open run), null on Projects
 * @property {() => string | null} run the run on screen
 * @property {(text: string, working?: boolean) => HTMLElement} botMsg
 * @property {(text: string) => void} youSaid
 * @property {boolean} off the hosted studio: no door
 */

/**
 * The moves, typed in the chat. Only a message that is one of these, whole: "push the button to the left" is
 * a change for the crew, not a push.
 * Also: "connect this to my repo owner/name" links one; "save this into ~/code/site" writes it into a folder of the
 * home folder; after a repository with other work is refused, "push to a new branch" or "bring its files in first";
 * after a folder write is refused, "replace them".
 * @param {string} text @returns {{ did: 'push' | 'pull' | 'where' | 'branch' | 'merge' | 'replace' } | { did: 'link', repo: string } | { did: 'folder', folder: string } | null}
 */
export function githubAsk(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
  const s = t.toLowerCase()
  const it = '(?:it |this |the (?:project|game|app|site|source|code) )?'
  if (new RegExp(`^(?:please )?(?:push|send|put|upload) ${it}(?:to|on) github$`).test(s)) return { did: 'push' }
  if (new RegExp(`^(?:please )?(?:pull|update|sync) ${it}from github$`).test(s) || /^(?:please )?pull (?:the )?(?:new|latest) (?:commits|changes) from github$/.test(s)) return { did: 'pull' }
  if (/^(?:where is (?:it|this|the (?:project|game|app|source|code)) on github|is (?:it|this) on github|github status|which (?:github )?repo(?:sitory)? is (?:it|this))$/.test(s)) return { did: 'where' }
  const link = t.match(/^(?:please )?(?:link|connect) (?:(?:it|this|the (?:project|game|app|site|source|code)) )?(?:to )?(?:my )?(?:github )?(?:repo(?:sitory)? )?((?:https:\/\/(?:www\.)?github\.com\/)?[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/i)
  if (link) return { did: 'link', repo: link[1].replace(/^https:\/\/(?:www\.)?github\.com\//i, '') }
  // a folder of the home folder, written as a path from the top or from ~ (never a word like "the footer")
  const into = t.match(/^(?:please )?(?:save|write|put|copy) (?:it |this |the (?:project|game|app|site|source|code) )?(?:in|into|to) ((?:~|\/|[A-Za-z]:[\\/])\S*)$/i)
  if (into) return { did: 'folder', folder: into[1].replace(/[\\/]+$/, '') || into[1] }
  if (/^(?:please )?(?:push (?:it |this )?to a new branch|(?:use|make) a new branch|new branch)$/.test(s)) return { did: 'branch' }
  if (/^(?:please )?bring (?:its|their|the(?: repo(?:sitory)?'s)?) files in(?: first)?$/.test(s)) return { did: 'merge' }
  if (/^(?:please )?(?:replace them|replace the files|write (?:it )?anyway)$/.test(s)) return { did: 'replace' }
  return null
}

// ---------- where builds go on GitHub (engine/ghowner.mjs): the person's account or one of their organizations.
// Typed in any chat: "publish to Swarm-Generations", "builds go to my account", "where do builds go". A name is
// taken only when it is the person's login or one of their organizations, so "publish to vercel" or "publish to
// production" never becomes a setting.
const NOT_OWNER = /^(?:github|gh|gh-pages|pages|vercel|cloudflare|netlify|local|localhost|feed|here|it|this|that|web|prod|production|staging)$/i
const ME = '(?:my (?:own )?(?:github )?(?:account|login|profile)|my (?:own )?github|me)'
const MOVE = '(?:please )?(?:(?:publish|send|put) (?:my |new |all )?(?:builds |sites |repos |repositories |everything )?(?:to|on|under|in(?:to)?)|(?:my |new )?builds (?:go|should go) (?:to|on|under|in(?:to)?))'

/**
 * A typed "where builds go" move, or null. `owner` is a name to check against the person's organizations (null:
 * their own account).
 * @param {string} text @returns {{ did: 'show' } | { did: 'set', owner: string | null } | null}
 */
export function ownerAsk(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
  const s = t.toLowerCase()
  if (/^(?:where do (?:my |new )?builds go(?: on github)?|where (?:do|does) (?:it|swarm) publish(?: on github)?|which (?:github )?(?:org|organization|account) do (?:my )?builds go (?:to|in))$/.test(s)) return { did: 'show' }
  if (new RegExp(`^${MOVE} ${ME}$`).test(s)) return { did: 'set', owner: null }
  const m = t.match(new RegExp(`^${MOVE} (?:the )?(?:github )?(?:org(?:anization)? )?(?:https://(?:www\\.)?github\\.com/)?@?([A-Za-z0-9][A-Za-z0-9-]{0,38})/?$`, 'i'))
  if (m && !NOT_OWNER.test(m[1])) return { did: 'set', owner: m[1] }
  return null
}

/**
 * @typedef {object} OwnerView
 * @property {string | null} login @property {string | null} owner the organization builds go to, null: the account
 * @property {{ login: string, can: boolean, why: string }[]} orgs @property {string | null} error
 */
/** "Builds go to Swarm-Generations." @param {OwnerView} v */
export const ownerWhere = v => (v.owner ? `New sites and repositories go to ${v.owner}.` : v.login ? `New sites and repositories go to your account, ${v.login}.` : v.error || 'Not signed in: run gh auth login.')

/**
 * The typed move, answered in the chat (true when it was one). Asks the server for the person's organizations
 * first: a name that is neither theirs nor one of them is not taken, and the message goes on as it would have.
 * @param {string} text
 * @param {{ api: (path: string, opts?: any) => Promise<Response>, said: (text: string) => void, answer: (text: string) => void }} host
 * @returns {Promise<boolean>}
 */
export async function ownerSay(text, host) {
  const want = ownerAsk(text)
  if (!want) return false
  /** @param {any} [opts] */
  const view = async opts => {
    const r = await host.api('/api/github/owner', opts).catch(() => null)
    const j = await r?.json().catch(() => ({}))
    return { ok: !!r?.ok, j: /** @type {any} */ (j || {}) }
  }
  const now = await view()
  if (!now.ok) return false
  const v = /** @type {OwnerView} */ (now.j)
  if (want.did === 'set' && want.owner) {
    const k = want.owner.toLowerCase()
    if (k !== String(v.login || '').toLowerCase() && !v.orgs.some(o => o.login.toLowerCase() === k)) return false
  }
  host.said(text)
  if (want.did === 'show') { host.answer(ownerWhere(v)); return true }
  const got = await view({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: want.owner }) })
  host.answer(got.ok ? ownerWhere(got.j) : String(got.j.error || 'That did not work'))
  return true
}

/** "3 min ago", for a time of this computer's clock @param {number | null} t @param {number} [now] */
export function githubAgo(t, now = Date.now()) {
  if (!t) return ''
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / 1440)} d ago`
}

/**
 * What is true, in a few plain lines (the sheet shows them; the chat joins them into its answer).
 * @param {GitHubState} st @param {number} [now] @returns {string[]}
 */
export function githubLines(st, now = Date.now()) {
  if (!st.source) return ['No app or game here yet']
  const out = []
  const from = st.origin ? `Brought in from ${st.origin.repo}${st.origin.path ? `/${st.origin.path}` : ''}` : ''
  if (!st.link) out.push(from || 'Not on GitHub')
  else {
    out.push(st.link.folder ? `${st.link.where}` : `${st.link.repo}, ${st.link.private ? 'private' : 'public'}`)
    const last = Math.max(st.link.pushed || 0, st.link.pulled || 0)
    if (last) out.push(`${last === st.link.pushed ? (st.link.folder ? 'Written' : 'Pushed') : 'Pulled'} ${githubAgo(last, now)}`)
    if (!st.link.fits) out.push('This version needs a repository of its own')
  }
  // a first push makes the repository in the organization builds go to (Settings › You › GitHub)
  if ((!st.link || !st.link.fits) && st.owner) out.push(`New repositories go to ${st.owner}`)
  if (!st.link && st.origin?.pulled) out.push(`Pulled ${githubAgo(st.origin.pulled, now)}`)
  if (st.ahead) out.push('Changes not pushed')
  if (st.behind) out.push('New commits to pull')
  if (st.link?.fits && !st.ahead && st.behind === false) out.push('Up to date')
  if (st.unreachable) out.push(st.unreachable)
  if (!st.login) out.push('Not signed in: run gh auth login')
  return out
}

/** the chat's answer to "where is this on github" @param {GitHubState} st @param {number} [now] */
export function githubWhere(st, now = Date.now()) {
  const lines = githubLines(st, now)
  const how = !st.source ? ' Bring one in from its GitHub menu.' : !st.link ? ' Say "push to github" to put its source there, private.' : ''
  return `${lines.join('. ')}.${how}`
}

const GH_DOING = { push: 'Pushing to GitHub', pull: 'Pulling from GitHub', bring: 'Bringing it in', check: 'Checking GitHub' }
const ghCap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The door: `open(project)` shows the sheet, `say(text)` takes a typed move (true when it was one).
 * @param {GitHubHost} host
 */
export function githubDoor(host) {
  const { esc } = host
  /** @param {string} id @param {any} [body] @param {string} [query] @returns {Promise<GitHubState>} */
  const ask = async (id, body, query = '') => {
    const r = await host.api(`/api/projects/${encodeURIComponent(id)}/github${query}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(String(j.error || 'That did not work')), j)
    return j
  }
  const runQ = () => (host.run() ? `&run=${encodeURIComponent(host.run() || '')}` : '')
  /** ask again until the job has ended; `tick` hears each step
   * @param {string} id @param {string} piece @param {(st: GitHubState) => void} tick @returns {Promise<GitHubState>} */
  const follow = async (id, piece, tick) => {
    for (;;) {
      const st = await ask(id, null, `?piece=${piece}`)
      if (st.job?.state !== 'working') return ask(id, null, `?piece=${piece}&check=1`).catch(() => st)
      tick(st)
      await new Promise(r => setTimeout(r, 900))
    }
  }
  const working = (/** @type {GitHubState['job']} */ job) => `<div class="gh-work" role="status" aria-busy="true">${cursor(CREW[1])}<span>${esc(ghCap(job?.step || GH_DOING[/** @type {keyof typeof GH_DOING} */ (job?.did || 'check')] || GH_DOING.check))}</span></div>`

  /** @param {string | null} [project] */
  function open(project = host.project()) {
    if (host.off || !project) return null
    const d = /** @type {any} */ (window).SwarmUI.dialog({ title: 'GitHub', className: 'gh-sheet', body: working(null) })
    /** @type {GitHubState | null} */
    let st = null
    let piece = '', kind = 'game', busy = false, said = ''
    // where an unlinked project goes: a new repository, or one that exists (picked from the person's, or typed)
    let way = 'new'
    /** @type {{ repo: string, private: boolean, empty: boolean }[] | null} */
    let repos = null
    let reposSaid = ''
    let reposAsked = false
    const loadRepos = async () => {
      if (reposAsked) return
      reposAsked = true
      /** @type {{ repo: string, private: boolean, empty: boolean }[]} */
      let got = []
      try {
        const r = await host.api('/api/github/repos')
        const j = await r.json().catch(() => ({}))
        if (!r.ok) reposSaid = String(j.error || 'GitHub did not list your repositories')
        else { got = Array.isArray(j.repos) ? j.repos : []; reposSaid = got.length ? '' : 'No repositories on your account or in your organizations' }
      } catch { reposSaid = 'GitHub did not list your repositories' }
      repos = got
      if (!d.closed) draw()
    }
    // what was typed stays in the fields when the sheet is drawn again (a refusal leaves it there to mend)
    const typed = { repo: '', path: '', folder: '', sub: '' }
    /** @type {any} the last move, made again with a yes */
    let lastMove = null
    const body = /** @type {HTMLElement} */ (d.body)
    /** @param {any} move */
    const go = async move => {
      if (busy || !st) return
      if (move.action === 'push' && !move.confirm) lastMove = move
      busy = true; said = ''
      const before = st
      st = { ...st, job: { did: move.action, state: 'working', step: '', message: '' } }
      draw()
      try {
        const got = await ask(project, { ...move, piece: move.action === 'bring' ? undefined : before.piece })
        piece = got.piece
        st = await follow(project, got.piece, s => { st = s; draw() })
        if (st.job?.state === 'done') Object.assign(typed, { repo: '', path: '' })
      } catch (e) {
        said = String(/** @type {any} */ (e)?.message || 'That did not work')
        st = { ...before, job: null }
      }
      busy = false
      if (!d.closed) draw()
    }
    /** a repository that holds other work: what it holds, and the two ways, each said before it happens @param {GitHubOther} o */
    const otherWay = o => {
      const files = `${o.files} file${o.files === 1 ? '' : 's'}`
      return `<div class="gh-other" role="group" aria-label="${esc(o.repo)} holds other work">
        <p class="gh-help"><b>${esc(o.repo)}</b> already holds other work on ${esc(o.branch)} (${files}). Nothing was changed. Choose how this project goes there:</p>
        <div class="gh-way"><button type="button" class="ui-btn ui-btn-default" data-mode="branch">Push to a new branch</button>
          <p class="gh-help">This project goes to a new branch of its own, swarm/${esc(st?.suggest || 'project')}. ${esc(o.branch)} is not touched. Then open a pull request on GitHub, to merge it when you choose.</p></div>
        ${o.bring ? `<p class="gh-help">Its files can't come in: ${esc(o.bring)}.</p>` : `<div class="gh-way"><button type="button" class="ui-btn ui-btn-outline" data-mode="merge">Bring its files in first</button>
          <p class="gh-help">Its ${files} come into this project, then this project is pushed on top of ${esc(o.branch)}. Where both have a file, this project's is kept; its history stays as it was. Nothing of it is run.</p></div>`}
      </div>`
    }
    /** a folder write that would replace files the project did not write: which, and the yes @param {GitHubChanges} c @param {string} words */
    const replaceWay = (c, words) => `<div class="gh-other" role="group" aria-label="Files that would be replaced">
        <p class="gh-help">${esc(words)}</p>
        <ul class="gh-lines">${c.theirs.map(p => `<li><code>${esc(p)}</code></li>`).join('')}${c.more ? `<li>and ${c.more} more</li>` : ''}</ul>
        <div class="gh-way"><button type="button" class="ui-btn ui-btn-outline" data-replace>Replace them</button>
          <p class="gh-help">Those files in ${esc(c.folder)} become this project's, with ${c.add} new and ${c.update} updated beside them. Nothing else there changes.</p></div>
      </div>`
    function draw() {
      if (!st) return
      const s = st, job = s.job, at = s.link, mid = job?.state === 'working'
      const needsName = s.source && (!at || !at.fits)
      const toggle = (/** @type {string} */ name, /** @type {string[][]} */ opts, /** @type {string} */ on, /** @type {string} */ attr) => `<div class="ui-toggle-group ui-block" role="radiogroup" aria-label="${name}">${opts.map(([k, n]) => `<button type="button" class="ui-toggle" role="radio" aria-checked="${k === on}" data-${attr}="${k}">${n}</button>`).join('')}</div>`
      const lines = githubLines(s).filter(l => !at || (at.folder ? l !== at.where : !l.startsWith(`${at.repo},`)))
      body.innerHTML = `<form class="gh-form" autocomplete="off">
        ${s.pieces.length > 1 ? toggle('Piece', [['game', 'Game'], ['app', 'App']], s.piece, 'piece') : ''}
        ${at?.folder ? `<p class="gh-repo"><span>${at.mode === 'checkout' ? 'Checkout' : 'Folder'}</span><code class="gh-path">${esc(at.mode === 'checkout' ? at.folder : at.where || '')}</code>${at.branch ? `<span>Branch ${esc(at.branch)}</span>` : ''}${mid ? '' : '<button type="button" class="ui-btn ui-btn-ghost ui-btn-sm gh-unlink" data-unlink>Unlink</button>'}</p>` : ''}
        ${at && !at.folder ? `<p class="gh-repo"><a href="${esc(at.url)}" target="_blank" rel="noopener">${esc(at.repo)}</a><span>${at.private ? 'Private' : 'Public'}</span>${at.branch ? `<span>Branch ${esc(at.branch)}</span>` : ''}${at.pr ? `<a href="${esc(at.pr)}" target="_blank" rel="noopener">Open a pull request</a>` : ''}${mid ? '' : '<button type="button" class="ui-btn ui-btn-ghost ui-btn-sm gh-unlink" data-unlink>Unlink</button>'}</p>` : ''}
        <ul class="gh-lines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        ${mid ? working(job) : ''}
        ${!mid && !s.source ? `<label class="ui-field"><span class="ui-label">Repository</span><input class="ui-input" name="repo" value="${esc(typed.repo)}" placeholder="owner/name" maxlength="200" required></label>
          <label class="ui-field"><span class="ui-label">Subfolder</span><input class="ui-input" name="path" value="${esc(typed.path)}" placeholder="web" maxlength="300"></label>
          ${toggle('Kind', [['game', 'Game'], ['app', 'App']], kind, 'kind')}` : ''}
        ${!mid && needsName ? `${toggle('Where it goes', [['new', 'New repository'], ['existing', 'An existing repository'], ['folder', 'A folder on this computer']], way, 'way')}
          ${way === 'folder' ? `<label class="ui-field"><span class="ui-label">Folder</span><input class="ui-input" name="folder" value="${esc(typed.folder)}" placeholder="~/code/site" maxlength="1000" required></label>
          <label class="ui-field"><span class="ui-label">Subfolder, for a folder that is not a git checkout</span><input class="ui-input" name="sub" value="${esc(typed.sub || s.suggest)}" placeholder="site" maxlength="200"></label>
          <p class="gh-help">A git checkout gets this project on a branch of its own, swarm/${esc(s.suggest)}: its other branches and its files are not touched, and nothing is pushed anywhere. Any other folder gets the files in the subfolder; a file there this project did not write is never replaced without asking first. Only a folder inside your home folder.</p>` : way === 'new' ? `<label class="ui-field"><span class="ui-label">Name</span><input class="ui-input" name="repo" value="${esc(typed.repo || s.suggest)}" placeholder="name" maxlength="100" required></label>
          ${toggle('Who can see it', [['private', 'Private'], ['public', 'Public']], 'private', 'see')}` : `<label class="ui-field"><span class="ui-label">Repository</span><input class="ui-input" name="repo" value="${esc(typed.repo)}" placeholder="owner/name or its address" maxlength="200" required list="gh-repos"></label>
          <datalist id="gh-repos">${(repos || []).map(r => `<option value="${esc(r.repo)}">${r.private ? 'private' : 'public'}${r.empty ? ', empty' : ''}</option>`).join('')}</datalist>
          ${repos ? (repos.length ? `<div class="gh-pick" role="list" aria-label="Your repositories">${repos.slice(0, 300).map(r => `<button type="button" class="ui-btn ui-btn-outline ui-btn-sm" role="listitem" data-pick="${esc(r.repo)}">${esc(r.repo)}${r.empty ? ' · empty' : ''}</button>`).join('')}</div>` : '') : `<p class="gh-help" role="status" aria-busy="true">Looking at your repositories…</p>`}
          ${reposSaid ? `<p class="gh-help">${esc(reposSaid)}</p>` : ''}
          <p class="gh-help">This project is pushed there. That works when the repository is empty or already holds this project's history; a repository with other work is left as it is, and nothing is ever overwritten.</p>`}` : ''}
        ${job?.state === 'done' && job.message ? `<p class="gh-done" role="status">${esc(job.message)}${job.url ? ` <a href="${esc(job.url)}" target="_blank" rel="noopener">${esc(String(job.url).replace(/^https:\/\//, ''))}</a>` : ''}${job.pr ? ` <a href="${esc(job.pr)}" target="_blank" rel="noopener">Open a pull request</a>` : ''}</p>` : ''}
        ${!mid && job?.state === 'failed' && job.other ? otherWay(job.other) : ''}
        ${!mid && job?.state === 'failed' && job.changes ? replaceWay(job.changes, job.message) : ''}
        ${said || (job?.state === 'failed' && !job.other && !job.changes) ? `<p class="bring-err" role="alert">${esc(said || job?.message || '')}</p>` : ''}
        <button type="submit" hidden></button>
      </form>`
      // the move a refusal offers leads: Pull after "has commits this project does not have"
      const pullFirst = !!(job?.pull || s.behind)
      const canPull = s.source && !!(at || s.origin)
      const btn = (/** @type {string} */ k, /** @type {string} */ n, /** @type {boolean} */ lead) => `<button type="button" class="ui-btn ${lead ? 'ui-btn-default' : 'ui-btn-outline'}" data-go="${k}"${mid ? ' disabled' : ''}>${n}</button>`
      d.setFooter(!s.source ? btn('bring', 'Bring in', true) : `${canPull ? btn('pull', 'Pull', pullFirst) : ''}${btn('push', at?.folder || (needsName && way === 'folder') ? 'Write' : 'Push', !pullFirst || !canPull)}`)
      const form = /** @type {HTMLFormElement} */ (body.querySelector('form'))
      const field = (/** @type {string} */ n) => /** @type {HTMLInputElement | null} */ (form.elements.namedItem(n))
      for (const b of /** @type {NodeListOf<HTMLElement>} */ (form.querySelectorAll('[role="radio"]'))) b.onclick = () => {
        for (const x of b.parentElement?.children || []) x.setAttribute('aria-checked', String(x === b))
        if (b.dataset.kind) kind = b.dataset.kind
        if (b.dataset.piece && b.dataset.piece !== s.piece) { piece = b.dataset.piece; load() }
        if (b.dataset.way && b.dataset.way !== way) { way = b.dataset.way; typed.repo = ''; said = ''; if (way === 'existing') loadRepos(); draw() }
      }
      const picks = /** @type {NodeListOf<HTMLElement>} */ (form.querySelectorAll('[data-pick]'))
      for (const b of picks) b.onclick = () => { const f = field('repo'); if (f) { f.value = b.dataset.pick || ''; f.focus() } }
      // what is typed narrows the list
      const typing = field('repo')
      if (typing && picks.length) typing.oninput = () => { const q = typing.value.trim().toLowerCase(); for (const b of picks) b.hidden = !!q && !String(b.dataset.pick).toLowerCase().includes(q) }
      const other = job?.state === 'failed' ? job.other : null
      for (const b of /** @type {NodeListOf<HTMLElement>} */ (form.querySelectorAll('[data-mode]'))) b.onclick = () => { if (other) go({ action: 'push', repo: other.repo, mode: b.dataset.mode }) }
      const unlink = /** @type {HTMLElement | null} */ (form.querySelector('[data-unlink]'))
      if (unlink) unlink.onclick = () => go({ action: 'unlink' })
      const replace = /** @type {HTMLElement | null} */ (form.querySelector('[data-replace]'))
      if (replace) replace.onclick = () => go({ ...(lastMove || { action: 'push' }), confirm: true })
      const move = (/** @type {string} */ k) => {
        const where = field('folder')
        if (k === 'push' && where) {
          if (!where.value.trim()) return where.focus()
          Object.assign(typed, { folder: where.value.trim(), sub: field('sub')?.value.trim() || '' })
          return go({ action: 'push', folder: where.value.trim(), sub: field('sub')?.value.trim() || undefined })
        }
        const repo = field('repo')
        if (k !== 'pull' && repo && !repo.value.trim()) return repo.focus()
        // a new repository is a name; one with an owner names a repository that exists
        if (k === 'push' && repo && way === 'new' && repo.value.includes('/')) { said = 'That names a repository that exists: pick An existing repository.'; return draw() }
        if (k === 'push' && repo && way === 'existing' && !repo.value.includes('/')) { said = 'Give the repository as owner/name, or pick one.'; return draw() }
        Object.assign(typed, { repo: repo?.value.trim() || '', path: field('path')?.value.trim() || '' })
        if (k === 'bring') return go({ action: 'bring', repo: repo?.value.trim(), path: field('path')?.value.trim() || '', kind })
        if (k === 'pull') return go({ action: 'pull' })
        go({ action: 'push', ...(repo ? { ...(repo.value.trim() === s.suggest ? {} : { repo: repo.value.trim() }), public: form.querySelector('[data-see="public"]')?.getAttribute('aria-checked') === 'true' } : {}) })
      }
      for (const b of /** @type {NodeListOf<HTMLElement>} */ (d.footer.querySelectorAll('[data-go]'))) b.onclick = () => move(b.dataset.go || '')
      form.onsubmit = e => { e.preventDefault(); move(!s.source ? 'bring' : pullFirst && canPull ? 'pull' : 'push') }
    }
    // the first look asks GitHub what is new there (one request), with the crew's cursor meanwhile
    async function load() {
      try {
        st = await ask(project || '', null, `?check=1${piece ? `&piece=${piece}` : runQ()}`)
        if (st.job?.state === 'working') { draw(); st = await follow(project || '', st.piece, s => { st = s; draw() }) }
        // what an earlier push or pull said is not news in a sheet opened later
        else st = { ...st, job: null }
      } catch (e) { body.innerHTML = `<p class="bring-err" role="alert">${esc(String(/** @type {any} */ (e)?.message || 'That did not work'))}</p>`; return }
      if (!d.closed) draw()
    }
    load()
    return d
  }

  /** a typed move: answered here, never sent to the builder @param {string} text */
  function say(text) {
    const want = host.off ? null : githubAsk(text)
    if (!want) return false
    host.youSaid(text)
    const project = host.project()
    if (!project) { host.botMsg('Open a project first: its GitHub is in its menu.'); return true }
    const item = host.botMsg(want.did === 'folder' || want.did === 'replace' ? 'Writing it' : GH_DOING[want.did === 'pull' ? 'pull' : want.did === 'where' ? 'check' : 'push'], true)
    item.classList.add('crew-wait')
    const head = item.querySelector('b'), txt = /** @type {HTMLElement} */ (item.querySelector('.txt'))
    const hermia = head?.innerHTML || ''
    if (head) head.innerHTML = `${cursor('')}${CREW[1]}`
    /** @param {string} words @param {string} [url] */
    const end = (words, url) => {
      item.classList.remove('working', 'crew-wait')
      if (head) head.innerHTML = hermia
      txt.textContent = words
      if (url) { const a = document.createElement('a'); a.className = 'gh-link'; a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = url.replace(/^https:\/\//, ''); txt.append(' ', a) }
    }
    ;(async () => {
      const first = await ask(project, null, `?check=1${runQ()}`)
      if (want.did === 'where') return end(githubWhere(first), first.link?.url || first.origin?.url)
      // the answer to a refusal is for the refusal still on screen: the repository that holds other work, or the
      // folder write that would replace files
      if ((want.did === 'branch' || want.did === 'merge') && !first.job?.other) return end('Nothing is waiting for that. Say "push to github" first.')
      if (want.did === 'merge' && first.job?.other?.bring) return end(`${first.job.other.repo}'s files can't come in: ${first.job.other.bring}. Say "push to a new branch".`)
      if (want.did === 'replace' && !first.job?.changes) return end('Nothing is waiting for that.')
      const body = want.did === 'link' ? { action: 'push', repo: want.repo }
        : want.did === 'folder' ? { action: 'push', folder: want.folder }
        : want.did === 'branch' || want.did === 'merge' ? { action: 'push', repo: first.job?.other?.repo, mode: want.did }
        : want.did === 'replace' ? { action: 'push', confirm: true }
        : { action: want.did }
      if (first.job?.state !== 'working') await ask(project, { ...body, piece: first.piece })
      const st = await follow(project, first.piece, s => { txt.textContent = ghCap(s.job?.step || txt.textContent || '') })
      const job = st.job
      const next = job?.pull ? ' Say "pull from github".'
        : job?.other ? ` Say "push to a new branch"${job.other.bring ? '' : ' or "bring its files in first"'}.`
        : job?.changes ? ' Say "replace them" to write it anyway.' : ''
      end(job?.state === 'failed' ? `${job.message}${next}` : `${job?.message || githubWhere(st)}${job?.pr ? ` Open a pull request: ${job.pr}` : ''}`, job?.state === 'failed' ? undefined : job?.url || st.link?.url || undefined)
    })().catch(e => end(String(e?.message || 'That did not work')))
    return true
  }
  return { open, say }
}
