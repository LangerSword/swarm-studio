// Where builds go on GitHub (docs/specs/45-intake.md, "Where builds go"): the person's own account (the default)
// or an organization they belong to, so the sites and sources the Studio makes do not fill their own profile.
// Both paths that make a repository use it: Publish › Website (engine/publish.mjs, GitHub Pages) and a project's
// source (engine/sourcehub.mjs, the first push). A repository already made or linked stays where it is.
//
// The choice is kept in the data folder's github.json, { "owner": "<organization>" }, read each time it is used,
// so a hand edit counts without a restart. No file, or no owner in it: the person's own account.
// The organizations come from `gh api user/orgs`; each says whether the person may make repositories there:
// an owner of the organization always may, a member when the organization lets members make public ones (a
// website is a public repository). The person's gh login does it all; no token is read or kept.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ghCli, ghLogin } from './sourcehub.mjs'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const file = dataDir => join(dataDir, 'github.json')

/** the organization builds go to, or null for the person's own account */
export function savedOwner(dataDir) {
  try { const o = JSON.parse(readFileSync(file(dataDir), 'utf8'))?.owner; return typeof o === 'string' && NAME.test(o) ? o : null } catch { return null }
}
function writeOwner(dataDir, owner) {
  let all = {}
  try { all = JSON.parse(readFileSync(file(dataDir), 'utf8')) || {} } catch {}
  if (owner) all.owner = owner
  else delete all.owner
  mkdirSync(dataDir, { recursive: true })
  const tmp = `${file(dataDir)}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 1))
  renameSync(tmp, file(dataDir))
}

const json = out => { try { return JSON.parse(out) } catch { return null } }
const said = text => String(text || '').split('\n').map(l => l.trim()).filter(Boolean).pop()?.slice(0, 200) || 'no answer'

/** One organization as the person's login sees it: { login, can, why }. `can` false comes with the plain reason. */
export async function orgFacts(org, gh = ghCli) {
  const m = await gh(['api', `user/memberships/orgs/${org}`, '--jq', '[.state, .role] | @json'])
  if (!m.ok) {
    if (/SAML|SSO/i.test(m.err)) return { login: org, can: false, why: 'Needs single sign-on: gh auth refresh' }
    if (/404|Not Found/i.test(m.err)) return { login: org, can: false, why: 'Not a member' }
    return { login: org, can: false, why: `GitHub did not answer: ${said(m.err)}` }
  }
  const [state, role] = json(m.out) || []
  if (state !== 'active') return { login: org, can: false, why: 'Invitation not accepted' }
  if (role === 'admin') return { login: org, can: true, why: '' }
  const o = await gh(['api', `orgs/${org}`, '--jq', '[.members_can_create_repositories, .members_can_create_public_repositories] | @json'])
  const [any, pub] = (o.ok && json(o.out)) || []
  // a member may make one unless the organization says no; the fields can be missing for a member, and then
  // GitHub itself answers when a repository is made
  if (any === false || pub === false) return { login: org, can: false, why: 'No permission to make repositories' }
  return { login: org, can: true, why: '' }
}

/** The person's organizations, each with whether builds can go there. → { login, orgs: [{ login, can, why }] }.
 * Throws in words when gh is not signed in or will not list them. */
export async function ghOrgs(gh = ghCli) {
  const login = await ghLogin(gh)
  if (!login) throw fail('GitHub CLI is not signed in: run gh auth login', 424)
  const r = await gh(['api', 'user/orgs', '--paginate', '--jq', '.[].login'])
  if (!r.ok) {
    if (/read:org|scope/i.test(r.err)) throw fail('gh cannot list your organizations: gh auth refresh -s read:org', 424)
    throw fail(`GitHub did not list your organizations: ${said(r.err)}`, 502)
  }
  const names = [...new Set(r.out.split('\n').map(s => s.trim()).filter(n => NAME.test(n)))].slice(0, 50)
  return { login, orgs: await Promise.all(names.map(n => orgFacts(n, gh))) }
}

/** What Settings and the chat show: who is signed in, where builds go now, and the organizations. Never throws. */
export async function ownerView(dataDir, gh = ghCli) {
  const owner = savedOwner(dataDir)
  try {
    const { login, orgs } = await ghOrgs(gh)
    return { login, owner, orgs, error: null }
  } catch (err) {
    return { login: await ghLogin(gh).catch(() => null), owner, orgs: [], error: String(err.message || err) }
  }
}

/** Choose where builds go: null or the person's own login is their account; an organization must be one of
 * theirs where they may make repositories. → the saved owner (null for their account) */
export async function chooseOwner(dataDir, owner, gh = ghCli) {
  const want = owner == null ? '' : String(owner).trim().replace(/^@/, '').replace(/^https:\/\/(?:www\.)?github\.com\//i, '').replace(/\/$/, '')
  if (want && !NAME.test(want)) throw fail('An organization name is letters, numbers and dashes')
  if (!want) { writeOwner(dataDir, null); return null }
  const { login, orgs } = await ghOrgs(gh)
  if (want.toLowerCase() === login.toLowerCase()) { writeOwner(dataDir, null); return null }
  const org = orgs.find(o => o.login.toLowerCase() === want.toLowerCase())
  if (!org) throw fail(`${want} is not one of your organizations`, 404)
  if (!org.can) throw fail(`${org.login} can't be used: ${org.why}`, 403)
  writeOwner(dataDir, org.login)
  return org.login
}

/** Where a new repository is made, asked each time one is about to be: { login, owner } (owner is the login
 * itself for the person's account). A chosen organization that can no longer be used stops it in words: the
 * repository is never made on the person's own account instead. */
export async function ownerFor(dataDir, gh = ghCli) {
  const login = await ghLogin(gh)
  if (!login) throw fail('GitHub CLI is not signed in: run gh auth login', 424)
  const org = dataDir ? savedOwner(dataDir) : null
  if (!org || org.toLowerCase() === login.toLowerCase()) return { login, owner: login }
  const f = await orgFacts(org, gh)
  if (!f.can) throw fail(`Builds go to ${org}, which can't be used: ${f.why}. Choose another in Settings › You › GitHub`, 403)
  return { login, owner: org }
}

// ---------- a published site whose repository moved (to an organization, or to another account)
// A site's address is saved when it is published (the build's publish:done: its url and its repository). When
// the repository is moved to another owner afterwards, GitHub Pages serves it at the new owner's address and the
// saved one stops answering. GitHub still answers for the old name with the repository where it is now, so one
// question tells: it is asked when the person opens Publish for that build (and a publish asks it anyway), never
// when Projects is listed. What it finds is kept beside the owner in github.json,
// { "sites": { "<build>": { "repo", "url", "from" } } }, and read with no network: `from` is the saved address
// it stands in for, so a later publish, which saves its own address, is never overruled.

/** Where a published site is now: { repo, url, moved }, or null when GitHub did not say (the saved one stands). */
export async function siteNow({ repo, url }, gh = ghCli) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) return null
  const r = await gh(['api', `repos/${repo}`, '--jq', '.full_name'], { timeout: 15000 })
  const full = r.ok ? String(r.out).trim() : ''
  if (!/^[\w.-]+\/[\w.-]+$/.test(full)) return null
  if (full.toLowerCase() === String(repo).toLowerCase()) return { repo: full, url, moved: false }
  const p = await gh(['api', `repos/${full}/pages`, '--jq', '.html_url'], { timeout: 15000 })
  const now = p.ok ? String(p.out).trim().replace(/\/?$/, '/') : ''
  if (!/^https:\/\//.test(now)) return null
  return { repo: full, url: now, moved: true }
}

/** The moved sites that were found, by build: { [build]: { repo, url, from } } */
export function movedSites(dataDir) {
  try { const m = JSON.parse(readFileSync(file(dataDir), 'utf8'))?.sites; return m && typeof m === 'object' ? m : {} } catch { return {} }
}
/** Keep where a build's site is now; `from` is the saved address it replaces. */
export function saveMoved(dataDir, key, { repo, url, from }) {
  let all = {}
  try { all = JSON.parse(readFileSync(file(dataDir), 'utf8')) || {} } catch {}
  all.sites = { ...(all.sites || {}), [key]: { repo, url, from } }
  mkdirSync(dataDir, { recursive: true })
  const tmp = `${file(dataDir)}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 1))
  renameSync(tmp, file(dataDir))
}
/** A build's GitHub address as it is now: the moved one while the saved address is still the one it replaced. */
export const currentSite = (moved, key, url) => (url && moved?.[key]?.from === url && moved[key].url ? moved[key].url : url)
