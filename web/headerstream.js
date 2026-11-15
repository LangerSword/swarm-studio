// @ts-check
// The server's token always travels in the x-swarm-token header, never in an address (catalog review of e8ae13c4:
// an address ends up in logs, history and Referer). The three things that used to need it in the query string,
// because a browser element cannot set a header, are read with fetch here instead, the same in both apps (the next
// UI imports this file as @studio/headerstream):
//   eventStream   the server's /events stream (EventSource), with its own reconnect
//   frameStream   a multipart/x-mixed-replace picture stream (an <img src> of MJPEG): each JPEG part, as a Blob
//   download      a file the person saves (an <a href download>)
// A fetch with the header works where a cookie cannot be relied on: Hermes Desktop shows the canvas in a sandboxed
// frame with an opaque origin (desktop/plugin.js).

export const TOKEN_HEADER = 'x-swarm-token'

/**
 * The complete events in an event-stream text, and what is left over: each event's joined `data:` lines; comment
 * lines (": hello", keep-alives) and other fields are skipped.
 * @param {string} text
 * @returns {{ events: string[], rest: string }}
 */
export function sseEvents(text) {
  const blocks = text.replace(/\r\n?/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const events = []
  for (const block of blocks) {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(l[5] === ' ' ? 6 : 5))
    if (data.length) events.push(data.join('\n'))
  }
  return { events, rest }
}

/**
 * The server's event stream, read with fetch: onMessage({ data }) for each event, as EventSource's onmessage. When the
 * stream ends or fails it opens again after retryMs, until close(). `opened` settles the first time it is open.
 * @param {string} url
 * @param {{ token?: string, onMessage: (m: { data: string }) => void, onOpen?: () => void, retryMs?: number, fetchImpl?: typeof fetch }} o
 * @returns {{ close: () => void, opened: Promise<void> }}
 */
export function eventStream(url, { token = '', onMessage, onOpen = () => {}, retryMs = 1500, fetchImpl = fetch }) {
  let closed = false, ctl = /** @type {AbortController | null} */ (null), timer = /** @type {any} */ (0)
  let isOpen = () => {}
  const opened = new Promise(r => { isOpen = () => r(undefined) })
  const again = () => { if (!closed) timer = setTimeout(open, retryMs) }
  async function open() {
    if (closed) return
    ctl = new AbortController()
    try {
      const res = await fetchImpl(url, { headers: { [TOKEN_HEADER]: token, accept: 'text/event-stream' }, cache: 'no-store', signal: ctl.signal })
      if (!res.ok || !res.body) return again()
      onOpen()
      isOpen()
      const reader = res.body.getReader(), dec = new TextDecoder()
      let rest = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const got = sseEvents(rest + dec.decode(value, { stream: true }))
        rest = got.rest
        for (const data of got.events) { try { onMessage({ data }) } catch (err) { console.error(err) } }
      }
    } catch { /* closed by us, or the server went away: open again */ }
    again()
  }
  open()
  return { close: () => { closed = true; clearTimeout(timer); ctl?.abort() }, opened }
}

const bytesIndexOf = (/** @type {Uint8Array} */ hay, /** @type {Uint8Array} */ needle, from = 0) => {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}
const PART_HEAD_END = new Uint8Array([13, 10, 13, 10])

/**
 * The complete parts in a multipart picture stream's bytes, and what is left over. Each part's headers name its
 * content-length (server/autoplay.mjs writeFrame), so a part is taken by its length, not by searching the picture.
 * @param {Uint8Array} bytes
 * @returns {{ frames: { type: string, body: Uint8Array }[], rest: Uint8Array }}
 */
export function multipartFrames(bytes) {
  const frames = []
  let at = 0
  for (;;) {
    const end = bytesIndexOf(bytes, PART_HEAD_END, at)
    if (end < 0) break
    const head = new TextDecoder().decode(bytes.subarray(at, end))
    const len = Number(head.match(/content-length:\s*(\d+)/i)?.[1])
    if (!Number.isFinite(len)) { at = end + 4; continue }
    const start = end + 4
    if (bytes.length < start + len) break
    frames.push({ type: head.match(/content-type:\s*([^\r\n]+)/i)?.[1].trim() || 'image/jpeg', body: bytes.slice(start, start + len) })
    at = start + len
  }
  return { frames, rest: bytes.slice(at) }
}

/**
 * A multipart picture stream, read with fetch: onFrame(blob) for each picture, onEnd() when the stream ends (the server
 * stopped it, or it failed). Not reopened: the caller asks again when there is something to show.
 * @param {string} url
 * @param {{ token?: string, onFrame: (b: Blob) => void, onEnd?: () => void, fetchImpl?: typeof fetch }} o
 * @returns {{ close: () => void }}
 */
export function frameStream(url, { token = '', onFrame, onEnd = () => {}, fetchImpl = fetch }) {
  const ctl = new AbortController()
  let closed = false
  ;(async () => {
    try {
      const res = await fetchImpl(url, { headers: { [TOKEN_HEADER]: token }, cache: 'no-store', signal: ctl.signal })
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      let buf = new Uint8Array(0)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const next = new Uint8Array(buf.length + value.length)
        next.set(buf)
        next.set(value, buf.length)
        const got = multipartFrames(next)
        buf = new Uint8Array(got.rest)
        for (const f of got.frames) onFrame(new Blob([new Uint8Array(f.body)], { type: f.type }))
      }
    } catch { /* closed, or the stream went away */ } finally { if (!closed) onEnd() }
  })()
  return { close: () => { closed = true; ctl.abort() } }
}

/**
 * A file the person saves, fetched with the header, then handed to the browser as a download under `name`.
 * @param {string} url
 * @param {{ token?: string, name: string, fetchImpl?: typeof fetch, doc?: Document }} o
 * @returns {Promise<void>}
 */
export async function download(url, { token = '', name, fetchImpl = fetch, doc = document }) {
  const res = await fetchImpl(url, { headers: { [TOKEN_HEADER]: token } })
  if (!res.ok) throw new Error(`the download did not start (HTTP ${res.status})`)
  const href = URL.createObjectURL(await res.blob())
  const a = doc.createElement('a')
  a.href = href
  a.download = name
  doc.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 60000)
}
