// @ts-check
// The planner's own words, checked against what really happened (owner, 2026-11-14 and 2026-11-15: the chat only
// says what is true). One runner for every kind of chat: the game chat's rules are in engine/gamestep.mjs
// (checkClaims), a website's and an app's in engine/chatstep.mjs (checkSaid). A rule names what a sentence claims
// and whether the facts bear it out; a sentence that claims what the facts deny is cut, whole. Deterministic: no
// model judges a model.

export const SENT = /[^.!?]+[.!?]*\s*/g

/**
 * @typedef {{ claims: (sentence: string) => boolean, ok: (sentence: string) => boolean }} ClaimRule
 * @param {string} text  @param {ClaimRule[]} rules
 * @returns {{ text: string, cut: string[] }} the text without the false sentences, and the sentences cut
 */
export function cutClaims(text, rules) {
  /** @type {string[]} */
  const cut = []
  const keep = (String(text || '').match(SENT) || []).filter(s => {
    const bad = rules.some(r => r.claims(s) && !r.ok(s))
    if (bad) cut.push(s.trim())
    return !bad
  })
  return { text: keep.join('').trim(), cut }
}
