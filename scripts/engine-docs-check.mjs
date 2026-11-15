// The engine pages (docs/engines/) are what every session reads before it says what an engine can or can't do
// (owner, 2026-11-12: "do we not have anyhting forcing agents or you to read the docs before you guess about a
// dependency"). Two checks:
//
//   node scripts/engine-docs-check.mjs                  every page is sound: a Glue line whose paths exist, and
//                                                       every claim cites its source or says "Unchecked"
//   node scripts/engine-docs-check.mjs --base <sha>     a pull request that changes an engine's glue code also
//                                                       changes that engine's page, or names the page in its
//                                                       description (read from $GITHUB_EVENT_PATH)
//
// A Glue entry names a whole file (`engine/meshy.mjs`), a folder (`dyad/`), or a part of a file several engines
// share (`server/server.mjs#meshy`). A part is the lines from `// engine: meshy` to `// end engine: meshy` (or the
// same with `#`), in as many blocks as the file needs. A part's page is owed only when the change's lines fall
// inside one of its blocks: added and changed lines as the file is now, removed lines as it was at the base.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.env.ENGINE_DOCS_ROOT || join(import.meta.dirname, '..')
const DIR = 'docs/engines'
// sections whose bullets are claims about the engine: each one carries its source. A bullet that ends in ":"
// heads a list; a sub-bullet may cite just ":line" in the file its parent named.
const CLAIMS = /^## (What it already does|How Swarm drives it|What the person connects|Limits inside Swarm)/
const CITED = /\((?:[^()]*?)(?:[\w.-]+\/[\w./-]+|[\w-]+\.(?:mjs|js|ts|tsx|md|yaml|yml|json|gd|py|sh))(?::\d+(?:-\d+)?)?[^()]*\)|https?:\/\/\S+|\((same (URL|file)|both URLs above)\)|\([^()]*:\d+[^()]*\)|:\s*$|Unchecked/

export function pages(dir = join(root, DIR)) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md').map(f => {
    const text = readFileSync(join(dir, f), 'utf8')
    const glue = (text.match(/^Glue:\s*(.+)$/m)?.[1] || '').split(',').map(s => s.trim().replace(/^`|`$/g, '')).filter(Boolean)
    return { file: `${DIR}/${f}`, text, glue }
  })
}

// the blocks of each part in a file's text, as { parts: { meshy: [[from, to], …] }, errors }: 1-based lines,
// the markers included; a part opened twice, closed without opening or never closed is an error
const MARK = /^\s*(?:\/\/|#)\s*(end )?engine:\s*([\w-]+)\s*$/
export function parts(text) {
  const out = {}, open = {}, errors = []
  String(text).split('\n').forEach((line, i) => {
    const m = line.replace(/\r$/, '').match(MARK)
    if (!m) return
    const [, end, name] = m
    if (!end) {
      if (open[name]) errors.push(`"engine: ${name}" at line ${i + 1} opens a part that is already open`)
      else open[name] = i + 1
    } else if (!open[name]) errors.push(`"end engine: ${name}" at line ${i + 1} closes nothing`)
    else { (out[name] ||= []).push([open[name], i + 1]); delete open[name] }
  })
  for (const [name, at] of Object.entries(open)) errors.push(`"engine: ${name}" at line ${at} is never closed`)
  return { parts: out, errors }
}

// the lines a `git diff -U0` changed in one file: removed (numbered as at the base) and added (numbered as now)
export function hunks(diff) {
  const removed = [], added = []
  for (const m of String(diff).matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const a = Number(m[1]), b = m[2] === undefined ? 1 : Number(m[2]), c = Number(m[3]), d = m[4] === undefined ? 1 : Number(m[4])
    for (let k = 0; k < b; k++) removed.push(a + k)
    for (let k = 0; k < d; k++) added.push(c + k)
  }
  return { removed, added }
}

// whether a change touched one part of a file: its added lines against the file now, its removed lines against
// the file at the base
export function touched({ part, now = '', before = '', diff = '' }) {
  const { removed, added } = hunks(diff)
  const inside = (blocks = [], lines) => lines.some(n => blocks.some(([a, b]) => n >= a && n <= b))
  return inside(parts(now).parts[part], added) || inside(parts(before).parts[part], removed)
}

// what is wrong with one page, as lines a person can act on
export function problems(page, exists = p => existsSync(join(root, p)), read = p => readFileSync(join(root, p), 'utf8')) {
  const out = []
  if (!page.glue.length) out.push(`${page.file}: no "Glue:" line naming the Swarm code that drives this engine`)
  for (const g of page.glue) {
    const [p, part] = g.split('#')
    if (!exists(p)) { out.push(`${page.file}: Glue names ${p}, which does not exist`); continue }
    if (!part) continue
    const found = parts(read(p))
    for (const e of found.errors) out.push(`${p}: ${e}`)
    if (!found.parts[part]) out.push(`${page.file}: Glue names ${g}, but ${p} has no "// engine: ${part}" … "// end engine: ${part}" block`)
  }
  let inClaims = false, bullet = null
  const flush = () => { if (bullet && !CITED.test(bullet.text)) out.push(`${page.file}:${bullet.line}: a claim with no source (add "(path:line)" or a URL, or start it with "Unchecked:")`) }
  page.text.split('\n').forEach((line, i) => {
    if (/^## /.test(line)) { flush(); bullet = null; inClaims = CLAIMS.test(line); return }
    if (!inClaims) return
    if (/^\s*[-*] /.test(line)) { flush(); bullet = { text: line, line: i + 1 } }
    else if (bullet && line.trim()) bullet.text += ` ${line.trim()}`
    else { flush(); bullet = null }
  })
  flush()
  return [...new Set(out)]
}

// the pages whose glue a change touched and that the change neither updated nor named; `hit(file, part)` says
// whether the change's lines fall inside that part of the file
export function unread(changed, all, body = '', hit = () => true) {
  const touches = g => {
    const [p, part] = g.split('#')
    if (part) return changed.includes(p) && hit(p, part)
    return changed.some(c => c === p || c.startsWith(p.endsWith('/') ? p : `${p}/`))
  }
  return all.filter(pg => pg.glue.some(touches))
    .filter(pg => !changed.includes(pg.file) && !body.includes(pg.file))
    .map(pg => pg.file)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const all = pages()
  const i = process.argv.indexOf('--base')
  if (i < 0) {
    const bad = [...new Set(all.flatMap(pg => problems(pg)))]
    if (bad.length) { console.error(bad.join('\n')); process.exit(1) }
    console.log(`engine pages: ${all.length} sound`)
  } else {
    const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] })
    const base = process.argv[i + 1], range = `${base}...HEAD`
    const changed = git('diff', '--name-only', range).split('\n').filter(Boolean)
    const fork = git('merge-base', base, 'HEAD').trim()
    const hit = (p, part) => touched({
      part,
      now: existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '',
      before: (() => { try { return git('show', `${fork}:${p}`) } catch { return '' } })(),
      diff: git('diff', '-U0', '--no-color', '--no-ext-diff', range, '--', p),
    })
    let body = ''
    try { body = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.body || '' } catch {}
    const miss = unread(changed, all, body, hit)
    if (miss.length) {
      console.error(`This change touches an engine's glue code. Read its page first, then update the page or name it in the PR description ("Read ${miss[0]}"):\n${miss.map(m => `- ${m}`).join('\n')}`)
      process.exit(1)
    }
    console.log('engine glue: every touched engine page was updated or named')
  }
}
