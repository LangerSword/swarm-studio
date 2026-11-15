// What a tool Hermia used found (decision 0025 e, docs/specs/48-chat-helper.md): three cards at most under her
// message, each with where it came from. A card with a button runs its action when pressed (POST /api/helper/pick,
// which looks the action up on the saved turn); the rest are to look at. The classic chat's twin: web/chatcards.js.
import { Button } from '../primitives/Button'
import type { ChatCard } from './types'

export function ChatCards({ cards, onPick, busy }: { cards: ChatCard[], onPick?: (card: ChatCard) => void, busy?: boolean }) {
  if (!cards.length) return null
  return (
    <div role="list" className="chat-cards mt-2 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
      {/* compact: the next UI's chat dock is short, so a card is a small picture beside its words */}
      {cards.slice(0, 3).map(c => (
        <div key={c.id} role="listitem" className={`flex min-w-0 items-center gap-2 rounded-[10px] border bg-surface-2 p-1.5 ${c.picked ? 'border-text' : 'border-line'}`}>
          {c.img && <img src={c.img} alt="" loading="lazy" draggable={false} className="size-12 shrink-0 rounded-[6px] bg-surface object-contain [image-rendering:pixelated]" />}
          <div className="flex min-w-0 flex-1 flex-col">
            <b className="truncate font-body text-xs font-semibold">{c.title}</b>
            <small className="line-clamp-2 font-body text-[11px] text-muted" title={c.source}>{c.source}</small>
            {c.picked ? <span className="font-body text-[11px] font-semibold">Done</span>
              : c.pick && onPick ? <Button role="ghost" className="mt-0.5 self-start" isDisabled={busy} onPress={() => onPick(c)}>{c.pick}</Button> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
