// @ts-check
// A game's art references on the Plan board (issue #543; the owner, 2026-11-15: "Game's art references"): a
// picture dropped anywhere on the board joins the plan (engine/planrefs.mjs), shows in its own section like a
// picked sheet, and Hermia asks the one question every drop asks (web/refdrop.js): like this (a look the painter
// and the crew match) or use as is (placed in the game as it is). The inspector switches between the two and
// removes it. Joined into the studio's one script (server/page.mjs): every top-level name says planRef.
import { ic } from './icons.js'
import { refDrop } from './refdrop.js'

/** @typedef {{ id: string, name: string, src: string, asIs?: boolean }} PlanRef */
/** @typedef {{ esc: (s: unknown) => string, base: () => string, sel: (key: string) => string }} PlanRefDraw */

/** The board's section, after the sketches; nothing until one is dropped.  @param {any} p  @param {PlanRefDraw} o */
export function planRefsHtml(p, { esc, base, sel }) {
  /** @type {PlanRef[]} */
  const live = (p?.refs || []).filter((/** @type {any} */ r) => !r.removed)
  if (!live.length) return ''
  const cards = live.map(r => `<div class="ab ppic sheet aref" data-key="ar:${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(r.name)}"><img src="${esc(base() + r.src)}" alt="" draggable="false" loading="lazy">${r.asIs ? `<b class="aref-tag">${ic('pin', 12)}As is</b>` : ''}<em>${esc(r.name)}</em>${sel(`ar:${r.id}`)}</div>`).join('')
  return `<section class="pj-sec pl-arefs" data-sec="arefs"><span class="al">Art references</span><div class="abs">${cards}</div></section>`
}

/** The inspector of one, or '' when the key is not one.  @param {any} p  @param {string} key  @param {PlanRefDraw} o */
export function planRefInsp(p, key, { esc }) {
  if (!key.startsWith('ar:')) return ''
  /** @type {PlanRef | undefined} */
  const r = (p?.refs || []).find((/** @type {any} */ x) => `ar:${x.id}` === key && !x.removed)
  if (!r) return ''
  const now = r.asIs ? 'Placed in the game as it is, never redrawn.' : 'A look to match: the painter and the crew follow it, like a picked sheet.'
  return `<h3><span>${esc(r.name)}</span><button class="ib sm pj-x" aria-label="Close">${ic('x', 16)}</button></h3><p class="pl-sum">${now}</p>
    <div class="pl-opts"><button type="button" class="pl-opt${r.asIs ? '' : ' on'}" data-ar="look">Like this</button><button type="button" class="pl-opt${r.asIs ? ' on' : ''}" data-ar="asis">${ic('pin', 14)}Use as is</button></div>
    <button class="btn ghost" data-ar="remove">${ic('trash', 15)}Remove</button>`
}

/**
 * The drop on the whole board, and the inspector's three buttons.
 * @param {{ root: HTMLElement, insp: HTMLElement, id: () => string | null, api: (path: string, opts?: RequestInit) => Promise<Response>,
 *   toast: (text: string) => void, take: (plan: any) => void, select: (key: string | null) => void, selected: () => string | null }} o
 */
export function planRefWire({ root, insp, id, api, toast, take, select, selected }) {
  const at = () => { const v = id(); return v ? `/api/plans/${encodeURIComponent(v)}` : null }
  // a drop answers the plan as it is now: the board is drawn from it, the new picture selected
  const planRefAfter = async (/** @type {any[]} */ added) => {
    const p = at()
    const j = p ? await api(`${p}/refs`).then(r => r.json()).catch(() => null) : null
    if (j?.plan) take(j.plan)
    if (added[0]) select(`ar:${added[0].id}`)
  }
  refDrop({ root, at, api, said: toast, done: (_refs, added) => { planRefAfter(added) }, asset: () => { planRefAfter([]) },
    hosted: () => document.body.classList.contains('hosted') })
  insp.addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-ar]'))
    const key = selected(), p = at()
    if (!b || !p || !key?.startsWith('ar:')) return
    const rid = key.slice(3), what = b.dataset.ar
    const send = what === 'remove' ? api(`${p}/refs/${rid}/remove`, { method: 'POST', body: '{}' })
      : api(`${p}/assets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: rid, asIs: what === 'asis' }) })
    send.then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j })
      .then(j => { if (what === 'remove') select(null); take(j.plan) })
      .catch(err => toast(String(err.message || err)))
  })
}
