// A build that looked something up first stops with what it found (decision 0025; web/researchstop.js, the same in
// the current Studio's chat, web/canvas/loop.js researchStop): each page with its link and what was taken, ✕ to take
// one out (in a project it leaves References), and Build with what is left.
import { useState } from 'react'
import { stopItems, takeOut, type Item, type Stop } from '@studio/researchstop'
import { Button, IconButton } from '../primitives/Button'

export function ResearchStop({ stop, post, onBuild }: { stop: Stop, post: (path: string, body: object) => Promise<unknown>, onBuild: (kept: Item[]) => void }) {
  const [kept, setKept] = useState<Item[]>(() => stopItems(stop))
  const [done, setDone] = useState(false)
  return (
    <div className="research-stop mt-2 flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {kept.map(k => (
          <li key={k.key} className="grid grid-cols-[1fr_auto] gap-x-2">
            <a href={k.url} target="_blank" rel="noopener noreferrer" className="break-words font-semibold text-text">{k.title} · {k.host}</a>
            {!done && <IconButton icon="x" label={`Take out ${k.title}`} size={14} className="row-span-2 self-start"
              onPress={() => { void takeOut(stop, k, post).catch(() => {}); setKept(list => list.filter(x => x !== k)) }} />}
            <span className="col-start-1 text-xs leading-relaxed text-muted">{k.took}</span>
          </li>
        ))}
      </ul>
      {!done && <div><Button role="primary" onPress={() => { setDone(true); onBuild(kept) }}>{kept.length ? 'Build with these' : 'Build without them'}</Button></div>}
    </div>
  )
}
