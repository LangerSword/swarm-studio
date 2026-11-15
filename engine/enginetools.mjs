// The app engine's web and picture tools, answered on the studio's own gateway (docs/engines/dyad.md, Limits).
// Dyad's web_search, web_fetch, web_crawl and generate_image call its engine's URL, which the runner points at the
// gateway (/llm/v1), on /tools/web-search, /tools/web-crawl and /images/generations. Each is answered here
// through Hermes, as the rest of the studio does: no provider key reaches this server or the engine, and the
// engine still talks only to the gateway (installEgressGuard, dyad/src/aba/headless.ts).
//
//   POST /llm/v1/tools/web-search  { query }               -> SSE, OpenAI-style deltas (tools/web_search.ts)
//   POST /llm/v1/tools/web-crawl   { url, markdownOnly }   -> { rootUrl, markdown, pages: [{ url, markdown }] } (web_fetch.ts)
//   POST /llm/v1/tools/web-crawl   { url }                 -> { rootUrl, markdown, screenshot } (web_crawl.ts: clone a site)
//   POST /llm/v1/images/generations { prompt }             -> { created, data: [{ b64_json }] } (generate_image.ts)
//
// web(body): the Hermes bridge's POST /web ({search, limit} → web_search, {urls} → web_extract; bridge.py `web`).
// walk(url): the site walk with its SSRF-guarded browser (engine/sitelook.mjs walkSite, engine/walkguard.mjs).
// paint({prompt}): a picture the way the studio paints (Hermes's image_generate) → { ok, path }.
// check(url): a public http(s) address or an error (engine/chatmedia.mjs publicUrl).
import { readFileSync, statSync } from 'node:fs'

export const TOOL_ROUTES = ['POST /llm/v1/tools/web-search', 'POST /llm/v1/tools/web-crawl', 'POST /llm/v1/images/generations']
const MAX_MARKDOWN = 60000, MAX_PICTURE = 12 << 20

// a search's results as the text the model reads: one numbered result a line, its address and its snippet
export function searchText(query, results = []) {
  if (!results.length) return `No results for "${query}".`
  return results.map((r, i) => `${i + 1}. ${String(r.title || r.url || '').trim()}\n   ${r.url}${r.description ? `\n   ${String(r.description).trim()}` : ''}`).join('\n\n')
}
// the SSE Dyad's web_search reads: the whole answer as one delta, then [DONE]
export const sse = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`

export function engineTools({ web, walk, paint, check }) {
  // one site walk at a time: each starts a browser
  let walking = Promise.resolve()
  const oneWalk = fn => { const p = walking.then(fn, fn); walking = p.catch(() => {}); return p }

  async function pageText(url) {
    const r = await web({ urls: [url] })
    const got = r?.ok ? r.res?.results?.[0] : null
    if (!got || got.error || !got.content) throw new Error(`could not read ${url}${got?.error ? `: ${got.error}` : r?.error ? `: ${r.error}` : ''}`)
    return { url: got.url || url, title: got.title || '', markdown: String(got.content).slice(0, MAX_MARKDOWN) }
  }

  const tools = {
    async 'POST /llm/v1/tools/web-search'(input) {
      const query = String(input.query || '').trim().slice(0, 500)
      if (!query) throw Object.assign(new Error('a search is needed'), { status: 400 })
      const r = await web({ search: query, limit: 8 })
      if (!r?.ok) throw new Error(`the web search did not answer${r?.error ? `: ${r.error}` : ''}`)
      return { sse: sse(searchText(query, r.res?.data?.web || [])) }
    },
    async 'POST /llm/v1/tools/web-crawl'(input) {
      const url = String(input.url || '').trim()
      await check(url)
      if (input.markdownOnly) {
        const p = await pageText(url)
        return { json: { rootUrl: url, markdown: p.markdown, pages: [{ url: p.url, markdown: p.markdown }] } }
      }
      // a clone: the page's words through Hermes, and one picture of it from the guarded walk
      const [p, seen] = await Promise.all([pageText(url), oneWalk(() => walk(url))])
      const shot = seen?.pages?.[0]?.shots?.[0]
      if (!shot) throw new Error(seen?.note || 'the page could not be photographed')
      return { json: { rootUrl: url, markdown: p.markdown, screenshot: `data:image/jpeg;base64,${Buffer.from(shot).toString('base64')}` } }
    },
    async 'POST /llm/v1/images/generations'(input) {
      const prompt = String(input.prompt || '').trim().slice(0, 4000)
      if (!prompt) throw Object.assign(new Error('a prompt is needed'), { status: 400 })
      const r = await paint({ prompt })
      if (!r?.ok || !r.path) throw new Error(`no picture: ${String(r?.error || 'the image tool did not answer').slice(0, 200)}`)
      if (statSync(r.path).size > MAX_PICTURE) throw new Error('the picture is too big to hand over')
      return { json: { created: Math.floor(Date.now() / 1000), data: [{ b64_json: readFileSync(r.path).toString('base64') }] } }
    }
  }
  // the answer to one request: the route's own, or a JSON error the tool reports in its words
  async function answer(route, body, res) {
    let input = {}
    try { input = JSON.parse(body.toString('utf8') || '{}') } catch {}
    try {
      const out = await tools[route](input)
      if (out.sse) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); return res.end(out.sse) }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out.json))
    } catch (err) {
      if (!res.headersSent) res.writeHead(err.status || 502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: String(err.message || err).slice(0, 300) } }))
    }
  }
  return { routes: TOOL_ROUTES, answer }
}
