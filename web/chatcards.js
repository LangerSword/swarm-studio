// @ts-check
// The chat's helper cards (decision 0025 e, docs/specs/48-chat-helper.md): what a tool Hermia used found, three at
// most, each with where it came from, under her message. A card with a button runs its action when pressed
// (POST /api/helper/pick, which looks the action up on the saved turn); the rest are to look at. Joined into the
// canvas's one script (server/page.mjs): every top-level name has chatCard in it.

/** @typedef {{ id: string, title: string, source: string, img?: string, note?: string, pick?: string, picked?: number }} ChatCard */

const chatCardEsc = (/** @type {unknown} */ s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

/** What the talk keeps of the cards for the next turn: their titles and sources (engine/helpers.mjs cardsLine). @param {ChatCard[] | undefined} cards */
export const chatCardsLine = cards => (cards?.length ? `\n[Shown: ${cards.map((c, i) => `${i + 1}. ${c.title} (${c.source})`).join('; ')}]` : '')

/**
 * The cards under one of Hermia's messages.
 * @param {HTMLElement} item  her message in the chat
 * @param {{ cards: ChatCard[], chat: string | null, turn: string | null, base?: string,
 *   api: (path: string, opts?: RequestInit) => Promise<Response>, said: (text: string) => void }} o
 *   said(text): Hermia's answer to a press, as her next message
 */
export function chatCards(item, { cards, chat, turn, base = '', api, said }) {
  if (!cards?.length) return null
  const row = document.createElement('div')
  row.className = 'chat-cards'
  row.setAttribute('role', 'list')
  const can = (/** @type {ChatCard} */ c) => !!(c.pick && chat && turn && !c.picked)
  row.innerHTML = cards.slice(0, 3).map(c => `<div class="chat-card${c.picked ? ' picked' : ''}" role="listitem" data-card="${chatCardEsc(c.id)}">
    ${c.img ? `<img src="${chatCardEsc(c.img.startsWith('/') ? base + c.img : c.img)}" alt="" loading="lazy" draggable="false">` : ''}
    <b>${chatCardEsc(c.title)}</b><small>${chatCardEsc(c.source)}</small>${c.note ? `<i>${chatCardEsc(c.note)}</i>` : ''}
    ${can(c) ? `<button type="button" class="btn ghost sm" data-pick="${chatCardEsc(c.id)}">${chatCardEsc(c.pick)}</button>` : c.picked ? '<span class="chat-card-done">Done</span>' : ''}</div>`).join('')
  row.addEventListener('click', async e => {
    const b = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-pick]'))
    if (!b || b.disabled) return
    b.disabled = true
    const res = await api('/api/helper/pick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat, turn, card: b.dataset.pick }) }).catch(() => null)
    const j = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) { b.disabled = false; said(j.error ? `That did not work: ${j.error}.` : 'That did not work. Try again.'); return }
    b.closest('.chat-card')?.classList.add('picked')
    b.replaceWith(Object.assign(document.createElement('span'), { className: 'chat-card-done', textContent: 'Done' }))
    said(j.text)
    // what was kept shows where it went: the boards that show References reload them
    window.dispatchEvent(new CustomEvent('swarm:refs'))
  })
  item.append(row)
  return row
}
