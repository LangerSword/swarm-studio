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
// pasted on the board (issue #607): words as a note { kind: 'note', text }, a link as { kind: 'link', url, source },
// neither with a file. A link is kept as its address and its site, never fetched by the Studio (decision 0025:
// anything online goes through Hermes's own tools or a connector the person granted).
const room = plan => { if (planRefs(plan).length >= PLAN_REF_MAX) throw fail(`a plan keeps ${PLAN_REF_MAX} art references at most; remove one first`) }
const newRef = (plan, r, now) => {
  const ref = { id: `ar${randomBytes(4).toString('hex')}`, file: null, src: null, asIs: false, added: now, removed: null, carried: [], ...r }
  plan.refs = [...(plan.refs || []), ref]
  return ref
}
export const PLAN_NOTE_MAX = 4000
export function addPlanNote(plan, { text, now = Date.now() }) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, PLAN_NOTE_MAX)
  if (!t) throw fail('no words')
  room(plan)
  return newRef(plan, { kind: 'note', name: clip(t.split('\n')[0], 60), text: t }, now)
}
// only http(s), and no login in it
export function addPlanLink(plan, { url, now = Date.now() }) {
  let u
  try { u = new URL(String(url ?? '').trim()) } catch { throw fail('a link: http or https') }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || String(url).length > 2000) throw fail('a link: http or https')
  room(plan)
  const source = u.hostname.replace(/^www\./, '')
  return newRef(plan, { kind: 'link', name: clip(source + (u.pathname === '/' ? '' : u.pathname), 80), url: u.href, source }, now)
}
const find = (plan, id) => {
  const r = REF_ID.test(String(id || '')) && (plan.refs || []).find(x => x.id === id)
  if (!r) throw fail('no such reference', 404)
  return r
}
export function removePlanRef(plan, id, now = Date.now()) { const r = find(plan, id); r.removed = now; return r }
// "Use as is": placed as it is in the game, never redrawn; false puts it back to a look to match. Pictures only.
export function planRefAsIs(plan, id, asIs = true) { const r = find(plan, id); if (r.kind && asIs) throw fail('only a picture is used as is'); r.asIs = !!asIs; return r }

// one picture for one part of the game ("use this for the boss", the chat's helper, decision 0025 e): the slot it
// is the look for, a sheet ('sheet:cast'), a mock ('mock:boss') or the backdrops ('backdrops'); null frees it.
// That picture goes first to the painter of that slot, and the brief says which it is for.
export const PLAN_SLOT = /^(sheet|mock):[a-z][a-z0-9-]{0,30}$|^backdrops$/
export function planRefFor(plan, id, slot) {
  const r = find(plan, id)
  if (slot != null && !PLAN_SLOT.test(String(slot))) throw fail('no such part of the game')
  r.for = slot || null
  if (slot) r.asIs = false
  return r
}
// the picture files kept for a slot, newest first
export const planSlotFiles = (plan, dir, slot) => planRefs(plan).filter(r => r.for === slot).reverse().map(r => join(dir, r.file)).filter(f => existsSync(f))
const slotName = slot => slot === 'backdrops' ? 'the backdrops' : `the ${slot.split(':')[1].replace(/-/g, ' ')} ${slot.startsWith('sheet:') ? 'sheet' : 'screen'}`

// the files the painter is given with the picked sheets (engine/planart.mjs sheetRefs)
export const planRefFiles = (plan, dir) => planRefs(plan).filter(r => r.file).map(r => join(dir, r.file)).filter(f => existsSync(f))

// the game brief's lines (engine/planart.mjs gameBrief)
export function planRefLines(plan) {
  const live = planRefs(plan)
  if (!live.length) return ''
  const pics = live.filter(r => !r.kind), look = pics.filter(r => !r.asIs), given = pics.filter(r => r.asIs)
  const notes = live.filter(r => r.kind === 'note'), links = live.filter(r => r.kind === 'link')
  return [
    look.length ? `The owner's art references: match their look in every picture and sprite:\n${look.map(r => `- ${r.name}: ${r.src}${r.for ? ` (for ${slotName(r.for)})` : ''}`).join('\n')}` : '',
    given.length ? `The owner's pictures to place as they are (never redrawn):\n${given.map(r => `- ${r.name}: ${r.src}`).join('\n')}` : '',
    notes.length ? `The owner's notes:\n${notes.map(r => `- ${r.text.replace(/\n+/g, ' ')}`).join('\n')}` : '',
    links.length ? `The owner's links (from ${[...new Set(links.map(r => r.source))].join(', ')}):\n${links.map(r => `- ${r.url}`).join('\n')}` : ''
  ].filter(Boolean).join('\n')
}

// into a project, once each: to(pid, { name, buf, asIs }) adds one there. Returns how many went; the plan is
// changed (each ref's `carried`), so the caller saves it.
export function carryPlanRefs(plan, dir, pid, to) {
  let n = 0
  for (const r of planRefs(plan)) {
    if ((r.carried || []).includes(pid)) continue
    // a note or a link goes as a text reference: its words, or its address
    const text = r.kind === 'note' ? r.text : r.kind === 'link' ? r.url : null
    const f = text == null ? join(dir, r.file) : null
    if (f && !existsSync(f)) continue
    const sent = text == null ? { name: r.name, buf: readFileSync(f), asIs: !!r.asIs } : { name: `${r.name.replace(/[\\/:*?"<>|]+/g, '-')}.txt`, buf: Buffer.from(text), asIs: false }
    try { to(pid, sent) } catch { continue }
    r.carried = [...(r.carried || []), pid]
    n++
  }
  return n
}
