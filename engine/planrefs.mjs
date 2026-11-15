// A game's art references (issue #543; the owner, 2026-11-15: "Game's art references"): a picture dropped on a
// game's Plan board is kept with the plan, since a plan has no project yet, and treated like a picked sheet: the
// painter is given it beside the picked sheets and the locked style names it, so the crew uses it for the look of
// the game. "Use as is" marks one to be placed as it is (a logo, a title card). When the plan's talk joins a
// project, its pictures are copied into that project: a reference to its References, one used as is to its Assets.
//
//   plan.refs: [{ id, name, file, src, asIs, added, removed, carried: [pid] }]
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { randomBytes } from 'node:crypto'

// what the Plan board's picture route serves (server/plans.mjs servePicture): pictures the painter can read
export const PLAN_REF_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
export const PLAN_REF_MAX = 24
const REF_ID = /^ar[0-9a-z]{6,16}$/
const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

// the live ones (not removed), oldest first
export const planRefs = plan => (plan?.refs || []).filter(r => !r.removed)

// a picture into the plan: its file beside the plan's own pictures (dir), named so the picture route serves it
export function addPlanRef(plan, dir, { name, buf, now = Date.now() }) {
  const ext = extname(String(name || '')).slice(1).toLowerCase()
  if (!PLAN_REF_TYPES[ext]) throw fail('a picture: PNG, JPEG or WebP')
  if (!buf?.length) throw fail('an empty file')
  if (planRefs(plan).length >= PLAN_REF_MAX) throw fail(`a plan keeps ${PLAN_REF_MAX} art references at most; remove one first`)
  const id = `ar${randomBytes(4).toString('hex')}`
  const file = `${id}.${ext === 'jpeg' ? 'jpg' : ext}`
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, file), buf)
  const r = { id, name: clip(String(name).replace(/[\\/:*?"<>|]+/g, '-'), 120) || file, file, src: `/plans/${plan.id}/${file}`, asIs: false, added: now, removed: null, carried: [] }
  plan.refs = [...(plan.refs || []), r]
  return r
}
const find = (plan, id) => {
  const r = REF_ID.test(String(id || '')) && (plan.refs || []).find(x => x.id === id)
  if (!r) throw fail('no such reference', 404)
  return r
}
export function removePlanRef(plan, id, now = Date.now()) { const r = find(plan, id); r.removed = now; return r }
// "Use as is": placed as it is in the game, never redrawn; false puts it back to a look to match
export function planRefAsIs(plan, id, asIs = true) { const r = find(plan, id); r.asIs = !!asIs; return r }

// the files the painter is given with the picked sheets (engine/planart.mjs sheetRefs)
export const planRefFiles = (plan, dir) => planRefs(plan).map(r => join(dir, r.file)).filter(f => existsSync(f))

// the game brief's lines (engine/planart.mjs gameBrief)
export function planRefLines(plan) {
  const live = planRefs(plan)
  if (!live.length) return ''
  const look = live.filter(r => !r.asIs), given = live.filter(r => r.asIs)
  return [
    look.length ? `The owner's art references: match their look in every picture and sprite:\n${look.map(r => `- ${r.name}: ${r.src}`).join('\n')}` : '',
    given.length ? `The owner's pictures to place as they are (never redrawn):\n${given.map(r => `- ${r.name}: ${r.src}`).join('\n')}` : ''
  ].filter(Boolean).join('\n')
}

// into a project, once each: to(pid, { name, buf, asIs }) adds one there. Returns how many went; the plan is
// changed (each ref's `carried`), so the caller saves it.
export function carryPlanRefs(plan, dir, pid, to) {
  let n = 0
  for (const r of planRefs(plan)) {
    if ((r.carried || []).includes(pid)) continue
    const f = join(dir, r.file)
    if (!existsSync(f)) continue
    try { to(pid, { name: r.name, buf: readFileSync(f), asIs: !!r.asIs }) } catch { continue }
    r.carried = [...(r.carried || []), pid]
    n++
  }
  return n
}
