// @ts-check
// What an empty picture on a game's Plan board says, and the board's next step (the owner's game board, 2026-11-15:
// the Mocks and Backdrops were blank grey boxes and nothing said what to do after the plan). Every stop says why and
// the one thing that makes it (docs/ux/AUDIT.md): Draw, Try again, Set up when no image model is signed in, Build for
// what the build paints, Lock style for backdrops. The next step is the game chat's own last line
// (engine/gamestep.mjs nextStep, served on the plan as `next`). Joined into the studio's one script (server/page.mjs):
// every top-level name says planTile or planNext.

/** @typedef {{ state?: string, error?: string } | null | undefined} PlanTileEntry */
/** @typedef {{ paint?: string, build?: boolean, style?: boolean } | null} PlanTileDoes */

/**
 * An empty or failed picture's state and its one action, or '' for a picture nothing can make yet.
 * @param {PlanTileEntry} e the picture's entry on the plan
 * @param {PlanTileDoes} does what makes it: its paint key (web/plan.js paintIt), Build, or the style lock
 * @param {{ noPainter: boolean, esc: (s: unknown) => string }} o
 */
export function planTileStop(e, does, { noPainter, esc }) {
  if (!does) return ''
  const failed = e?.state === 'failed'
  const [why, label, attr] = noPainter ? ['No image model', 'Set up', 'data-setup']
    : does.build ? ['Not painted', 'Build', 'data-build']
    : does.style ? ['Style not locked', 'Lock style', 'data-style-lock']
    : [failed ? `Didn't paint${e?.error ? ` · ${e.error}` : ''}` : 'Not painted', failed ? 'Try again' : 'Draw', `data-paint="${esc(does.paint || '')}"`]
  return `<span class="pl-wait"><span>${esc(why)}</span><b class="pl-act" ${attr}>${label}</b></span>`
}

/**
 * The next step, at the top of the plan: the stop when no image model is signed in, else the chat's own line.
 * @param {{ next?: string } | null} p the plan as served
 * @param {{ noPainter: boolean, writing: boolean, esc: (s: unknown) => string }} o
 */
export function planNextHtml(p, { noPainter, writing, esc }) {
  if (noPainter) return '<p class="pl-next"><span>Pictures need an image model.</span><button type="button" class="pl-act" data-setup>Set up</button></p>'
  return p?.next && !writing ? `<p class="pl-next"><span>${esc(p.next)}</span></p>` : ''
}

/**
 * A tile's or the next step's action, pressed: true when it was one (the tile itself is not selected then).
 * @param {EventTarget | null} target
 * @param {{ setup: () => void, build: () => void, lockStyle: () => void, paint: (what: string, el: HTMLElement) => void }} run
 */
export function planTileChip(target, run) {
  const chip = /** @type {HTMLElement | null} */ (target instanceof Element ? target.closest('.pl-act') : null)
  if (!chip) return false
  if (chip.hasAttribute('data-setup')) run.setup()
  else if (chip.hasAttribute('data-build')) run.build()
  else if (chip.hasAttribute('data-style-lock')) run.lockStyle()
  else run.paint(chip.dataset.paint || '', chip)
  return true
}

/** No image model signed in: the plan routes' 503 (server/plans.mjs noPainter).  @param {{ status?: number, message?: string }} err */
export const planTileNoPainter = err => err?.status === 503 && /image model/.test(String(err.message || ''))
