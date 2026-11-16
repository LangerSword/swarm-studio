// @ts-check
// The Map window (spec 44): a build as diagrams, drawn with Mermaid. One window, shown as the wall's first window
// while the crew builds (web/canvas/dock.js) or alone on the stage (web/canvas/rooms.js). It holds the standing
// map the server makes from what it knows (GET /api/runs/<id>/map: a tab per diagram) and, when the chat asked for
// one, a diagram the planner wrote (the Asked tab).
//
// Mermaid is the pinned copy in web/vendor/mermaid/ (scripts/vendor.mjs), a classic script fetched from the
// plugin's own server the first time a Map is on screen, never before and never from anywhere else. It renders
// with securityLevel strict. The standing map's labels are the person's own words, cleaned by the server; an asked
// diagram is a model's text, so it is untrusted: capped in size, parsed before it is drawn, and a diagram that
// does not parse is a plain line, not an error picture. Mermaid's SVG is put in as nodes with scripts, event
// attributes and outside links taken out, and nothing a model wrote is ever set as HTML.
//
// Imports only the pure rules; the room hands it the cursor, the icons and the address.
import { chartFits, mapLook, mapList, chartWords } from './mapask.js'

/**
 * @typedef {{ id: string, name: string, text: string, marks?: boolean, nodes?: { name: string, state?: string }[] }} MapTab
 * @typedef {{ kind: string, version: string, tabs: MapTab[], say: string }} MapData
 * @typedef {{ busy?: boolean, text?: string, fail?: boolean }} MapAsked
 */

/**
 * @param {object} h
 * @param {string} h.src the address of the vendored Mermaid script
 * @param {string} h.cursor Hermia's cursor (markup the Studio's own code made)
 * @param {{ grow: string, shrink: string }} h.icons the enlarge button's two icons
 */
export function mapWindow({ src, cursor, icons }) {
  const el = document.createElement('section')
  el.className = 'cw-map'
  el.setAttribute('aria-label', 'Map')
  el.innerHTML = '<div class="cw-file"><span class="cw-path">Map</span><div class="mp-tabs" role="group" aria-label="Diagrams"></div><button type="button" class="mp-reset" aria-label="Fit the Map in the window" hidden>Recentre</button><button type="button" class="mp-zoom" aria-expanded="false" aria-label="Enlarge the Map"></button></div>'
    + '<div class="mp-body"><div class="mp-pan"><div class="mp-pic"></div></div></div><ol class="mp-alt"></ol>'
  const tabsEl = /** @type {HTMLElement} */ (el.querySelector('.mp-tabs')), body = /** @type {HTMLElement} */ (el.querySelector('.mp-body'))
  const picEl = /** @type {HTMLElement} */ (el.querySelector('.mp-pic'))
  const resetBtn = /** @type {HTMLButtonElement} */ (el.querySelector('.mp-reset'))
  const alt = /** @type {HTMLElement} */ (el.querySelector('.mp-alt')), zoomBtn = /** @type {HTMLButtonElement} */ (el.querySelector('.mp-zoom'))
  /** @type {{ map: MapData | null | undefined, asked: MapAsked | null, tab: string, drawn: string, tabsKey: string, working: boolean, big: boolean, n: number }} */
  const st = { map: undefined, asked: null, tab: '', drawn: '', tabsKey: '', working: false, big: false, n: 0 }
  /** @type {{ zoom: (() => void) | null }} */
  const on = { zoom: null }
  zoomBtn.innerHTML = icons.grow
  zoomBtn.onclick = () => on.zoom?.()

  // ---------- zooming the diagram (the person, 2026-11-16: "wish this map had zoom in zoom out feature").
  // The diagram used to be forced to the window's size, so a plan wider than the window kept its end cut
  // off and nothing made it readable. Now the picture keeps its own size inside a panning box: the wheel
  // or a pinch zooms about the pointer, dragging moves it, and a Recentre button appears only once it has
  // been moved off its place (docs/ux/RULES.md, rule 22: direct manipulation, and the button is the way back).
  const view = { k: 1, x: 0, y: 0, moved: false }
  const K = { min: 0.2, max: 6 }
  const apply = () => {
    picEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`
    // the button is the way home, shown only once there is somewhere to come back from
    resetBtn.hidden = !view.moved
    body.classList.toggle('zoomed', view.k > 1.001 || view.moved)
  }
  const reset = () => { Object.assign(view, { k: 1, x: 0, y: 0, moved: false }); apply() }
  resetBtn.onclick = reset
  /** zoom by `f` about a point in the window's own coordinates */
  const zoomAt = (f, cx, cy) => {
    const r = body.getBoundingClientRect(), px = cx - r.left, py = cy - r.top
    const k2 = Math.min(K.max, Math.max(K.min, view.k * f))
    if (k2 === view.k) return
    // keep the point under the pointer still: the box is centred, so the offset scales with the picture
    view.x = px - (px - view.x) * (k2 / view.k)
    view.y = py - (py - view.y) * (k2 / view.k)
    view.k = k2
    if (k2 !== 1) view.moved = true
    apply()
  }
  body.addEventListener('wheel', e => {
    if (!picEl.firstElementChild) return
    // the wheel zooms rather than scrolls, but ctrl+wheel (a pinch on a trackpad) does not zoom the whole page
    e.preventDefault()
    zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY)
  }, { passive: false })
  // dragging moves the diagram; a drag that went nowhere is left to the click that enlarges the Map
  let drag = null
  body.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !picEl.firstElementChild) return
    drag = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false }
    body.setPointerCapture(e.pointerId)
  })
  body.addEventListener('pointermove', e => {
    if (!drag) return
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    drag.moved = true
    view.x = drag.ox + dx
    view.y = drag.oy + dy
    view.moved = true
    body.classList.add('dragging')
    apply()
  })
  const endDrag = () => {
    if (!drag) return
    const moved = drag.moved
    drag = null
    body.classList.remove('dragging')
    // a real drag is not also a click: enlarging the Map mid-pan would be a surprise
    if (moved) body.dataset.panned = '1'
    setTimeout(() => delete body.dataset.panned, 0)
  }
  body.addEventListener('pointerup', endDrag)
  body.addEventListener('pointercancel', endDrag)
  // a pinch on a touch screen (two fingers): the same zoom, about the fingers' middle
  let pinch = null
  const spread = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  body.addEventListener('touchstart', e => {
    if (e.touches.length !== 2 || !picEl.firstElementChild) return
    pinch = { d: spread([e.touches[0], e.touches[1]]) }
  }, { passive: true })
  body.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return
    e.preventDefault()
    const d = spread([e.touches[0], e.touches[1]])
    if (pinch.d > 0) zoomAt(d / pinch.d, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2)
    pinch.d = d
  }, { passive: false })
  body.addEventListener('touchend', () => { pinch = null }, { passive: true })
  // zoom in or out from the keyboard while the diagram has focus
  body.tabIndex = 0
  body.addEventListener('keydown', e => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); const r = body.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); const r = body.getBoundingClientRect(); zoomAt(0.8, r.left + r.width / 2, r.top + r.height / 2) }
    else if (e.key === '0') { e.preventDefault(); reset() }
  })
  // a new diagram starts fitted, not wherever the last one was left
  // a click on the diagram enlarges it, as on the wall's other windows (but not the click that ended a pan)
  body.onclick = () => { if (!zoomBtn.hidden && !body.dataset.panned) on.zoom?.() }

  /** @type {Promise<any> | null} */
  let lib = null
  const load = () => (lib ||= new Promise((resolve, reject) => {
    const w = /** @type {any} */ (window)
    if (w.mermaid) return resolve(w.mermaid)
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => (w.mermaid ? resolve(w.mermaid) : reject(new Error('Mermaid did not load')))
    s.onerror = () => { lib = null; reject(new Error('Mermaid did not load')) }
    document.head.append(s)
  }))

  /** the tabs there are now: the standing map's, then the asked diagram's */
  const tabs = () => [...(st.map?.tabs || []), ...(st.asked ? [{ id: 'asked', name: 'Asked', text: st.asked.text || '', marks: false }] : [])]
  const current = () => { const all = tabs(); return all.find(t => t.id === st.tab) || all[0] || null }

  function paintTabs() {
    const all = tabs(), now = current()
    const key = `${all.map(t => `${t.id}:${t.name}`).join('|')}>${now?.id}`
    if (key === st.tabsKey) return
    st.tabsKey = key
    tabsEl.replaceChildren(...all.map(t => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = t.name
      b.setAttribute('aria-pressed', String(t.id === now?.id))
      b.classList.toggle('on', t.id === now?.id)
      b.onclick = () => { st.tab = t.id; draw() }
      return b
    }))
    tabsEl.hidden = all.length < 2
  }

  /** Replace what the window shows. Text and skeletons go in the body itself; a diagram goes in the pannable
   *  picture, so it keeps its own size and the wheel and drag have something to move.  @param {Node} node  @param {boolean} [panned] */
  function fill(node, panned = false) {
    if (panned) {
      let pan = /** @type {HTMLElement | null} */ (body.querySelector(':scope > .mp-pan'))
      if (!pan) {
        pan = document.createElement('div')
        pan.className = 'mp-pan'
        pan.append(picEl)
      }
      body.replaceChildren(pan)
      picEl.replaceChildren(node)
    } else {
      body.replaceChildren(node)
    }
    // anything new starts fitted, not wherever the last diagram was left
    reset()
  }
  /** the shape of a diagram while it is fetched or written, with Hermia's cursor on it (aria-busy)  @param {string} label */
  function skeleton(label) {
    const d = document.createElement('div')
    d.className = 'mp-skel'
    d.setAttribute('role', 'status')
    d.setAttribute('aria-busy', 'true')
    d.setAttribute('aria-label', label)
    d.innerHTML = `<i></i><b></b><i></i><b></b><i></i><em class="mp-bot" aria-hidden="true">${cursor}</em>`
    fill(d)
    alt.replaceChildren()
  }
  /** @param {string} line */
  function plain(line) {
    const p = document.createElement('p')
    p.className = 'mp-none'
    p.textContent = line
    fill(p)
    alt.replaceChildren()
  }
  /** Mermaid's SVG as nodes, with nothing in it that runs or leaves the page  @param {string} svg  @param {string} label  @param {string[]} list */
  function place(svg, label, list) {
    const doc = new DOMParser().parseFromString(svg, 'text/html')
    const pic = doc.body.querySelector('svg')
    if (!pic) return plain('Could not draw that.')
    for (const bad of pic.querySelectorAll('script, iframe, object, embed, link, meta, title')) bad.remove()
    for (const node of [pic, ...pic.querySelectorAll('*')]) for (const a of [...node.attributes]) {
      const name = a.name.toLowerCase()
      if (name.startsWith('on') || name === 'title' || ((name === 'href' || name === 'xlink:href' || name === 'src') && !a.value.startsWith('#'))) node.removeAttribute(a.name)
    }
    const fig = document.createElement('div')
    fig.className = 'mp-fig'
    fig.setAttribute('role', 'img')
    fig.setAttribute('aria-label', label)
    fig.append(document.adoptNode(pic))
    fill(fig, true)
    alt.replaceChildren(...list.map(w => { const li = document.createElement('li'); li.textContent = w; return li }))
  }

  const token = n => getComputedStyle(document.documentElement).getPropertyValue(n)
  // Draw what the window holds now, if it is on screen and anything changed (the data, the tab, the theme).
  async function draw() {
    paintTabs()
    if (!el.isConnected || !el.getClientRects().length) return
    const tab = current(), look = mapLook(token)
    const asked = tab?.id === 'asked' ? st.asked : null
    const state = asked?.busy ? 'busy' : asked?.fail ? 'fail' : !tab ? (st.map === undefined ? 'wait' : 'none') : 'draw'
    const key = `${state}|${tab?.id}|${tab?.text}|${look.key}`
    if (key === st.drawn || st.working) return
    st.drawn = key
    if (state === 'busy') return skeleton('Hermia is drawing it')
    if (state === 'wait') return skeleton('Drawing the map')
    if (state === 'none') return plain('No plan to draw yet.')
    if (state === 'fail' || !tab || !chartFits(tab.text)) return plain('Could not draw that.')
    st.working = true
    // only the first time, while Mermaid itself is fetched, the window shows the diagram's shape
    if (!(/** @type {any} */ (window)).mermaid) skeleton('Drawing the map')
    try {
      const m = await load()
      m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: look.vars, fontFamily: getComputedStyle(document.body).fontFamily, flowchart: { htmlLabels: true, useMaxWidth: true, wrappingWidth: 240 }, er: { useMaxWidth: true }, suppressErrorRendering: true, maxTextSize: 20000 })
      const text = tab.marks ? `${tab.text}\n${look.defs.map(d => `  ${d}`).join('\n')}` : tab.text
      // parsed first: a diagram that does not parse is a plain line, never Mermaid's own error picture
      if (!(await m.parse(text, { suppressErrors: true }))) plain('Could not draw that.')
      else {
        const { svg } = await m.render(`mp-svg-${++st.n}`, text)
        place(svg, `${tab.name} diagram`, tab.id === 'asked' ? chartWords(tab.text) : mapList(tab.nodes))
      }
    } catch {
      plain('Could not draw that.')
    } finally {
      // (Mermaid can leave its measuring box behind when a render throws)
      document.getElementById(`dmp-svg-${st.n}`)?.remove()
      st.working = false
    }
    // what changed while this was drawn is drawn next
    draw()
  }

  return {
    el,
    /** The standing map as the server gave it; null: this build has no plan to draw; undefined: not read yet.  @param {MapData | null | undefined} map */
    set(map) { st.map = map; draw() },
    /** A diagram the chat asked for: being written ({ busy }), written ({ text }), or not drawable ({ fail }); null takes its tab away.  @param {MapAsked | null} asked */
    ask(asked) { st.asked = asked; if (asked) st.tab = 'asked'; else if (st.tab === 'asked') st.tab = ''; draw() },
    /** Show one of the standing tabs (the first when it is not named).  @param {string} [id] */
    show(id = '') { st.tab = id; draw() },
    /** Enlarged on the wall or not: the button says which.  @param {boolean} big */
    big(big) {
      if (st.big === big) return
      st.big = big
      el.classList.toggle('big', big)
      zoomBtn.setAttribute('aria-expanded', String(big))
      zoomBtn.setAttribute('aria-label', big ? 'Shrink the Map' : 'Enlarge the Map')
      zoomBtn.innerHTML = big ? icons.shrink : icons.grow
    },
    /** Alone on the stage there is nothing to enlarge against.  @param {boolean} alone */
    alone(alone) { zoomBtn.hidden = alone; el.classList.toggle('alone', alone) },
    /** @param {() => void} fn */
    onZoom(fn) { on.zoom = fn },
    draw,
    say: () => st.map?.say || '',
    has: () => !!st.map
  }
}
