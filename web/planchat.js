// @ts-check
// A game's Plan board talks beside its chat, docked at the bottom like every screen (decision 0015). Only a new game's
// talk (Make › Game, a game chat from Chats) opened the chat; a plan opened any other way (its project card, the
// address, a reload) showed the board alone (the owner, 2026-11-15: "i dont even see the chat anymore here"). The
// board now opens its plan's own chat: the talk it was made in, or one the server makes for a plan that has none
// (server/talk.mjs GET /api/talk/plan/:id). Joined into the studio's one script (server/page.mjs): every top-level
// name says planChat.

/**
 * @typedef {{ on: boolean, kind: string, plan: string | null, chat: string | null,
 *   start: (o: { kind: string, chat: string, said: { who: string, text: string }[], blank: boolean }) => unknown,
 *   saidOf: (chat: any) => { who: string, text: string }[] }} PlanChatTalk
 */

/**
 * Dock the chat and open the plan's own talk in it, unless a game talk about this plan is already there.
 * @param {string | null | undefined} id the plan
 * @param {{ chat: (on: boolean) => void, api: (path: string) => Promise<Response>, talk: PlanChatTalk }} o
 * @returns {Promise<'docked' | 'kept' | 'opened'>}
 */
export async function planChatOpen(id, { chat, api, talk }) {
  chat(true)
  const ours = (/** @type {string | null} */ c) => talk.on && talk.kind === 'game' && (talk.plan === id || (!!c && talk.chat === c))
  if (!id || ours(null)) return id ? 'kept' : 'docked'
  const j = await api(`/api/talk/plan/${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
  // a game talk may have started on this plan while it was asked for (Make › Game hands its chat over itself)
  if (!j?.chat?.id || ours(j.chat.id)) return 'kept'
  talk.start({ kind: 'game', chat: j.chat.id, said: talk.saidOf(j.chat), blank: true })
  return 'opened'
}
