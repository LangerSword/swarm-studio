// @ts-check
// The Plan board fits the whole plan once, when it first draws (web/plan.js). Inside Hermes Desktop the Studio's pane
// settles to its size after that, and the chat docking or folding changes the stage too; the board kept its first fit:
// framed in a wide pane and then shrunk, it sat to the right of an empty strip with its rows cut off (the owner's
// Rank Juggler board, 2026-11-15). It now fits again whenever the stage changes size, as long as the person has not
// moved the view themselves (panned, zoomed, or brought a part into view). Joined into the studio's one script
// (server/page.mjs): every top-level name says planFit.

/** @typedef {{ x: number, y: number, k: number }} PlanFitCam */

/** The same view, to a hundredth of a pixel.  @param {PlanFitCam} a  @param {PlanFitCam} b */
export const planFitSame = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.k - b.k) < 1e-4

/**
 * Fit again when the stage changes size, while the view is still the one the last fit made.
 * @param {{ stage: HTMLElement, cam: PlanFitCam, frameAll: (animate?: boolean) => void }} bd the board (web/board.js)
 * @param {{ framed: () => boolean }} o framed: the board has had its first fit
 * @returns {{ fitted: () => void, stop: () => void }} fitted: call after a fit of the board's own
 */
export function planFitWatch(bd, { framed }) {
  /** @type {PlanFitCam | null} */
  let fit = null
  let size = ''
  const fitted = () => { fit = { ...bd.cam } }
  const ro = new ResizeObserver(() => {
    const now = `${bd.stage.clientWidth}x${bd.stage.clientHeight}`
    if (now === size) return
    size = now
    if (!bd.stage.clientWidth || !framed() || !fit || !planFitSame(bd.cam, fit)) return
    bd.frameAll(false)
    fitted()
  })
  ro.observe(bd.stage)
  return { fitted, stop: () => ro.disconnect() }
}
