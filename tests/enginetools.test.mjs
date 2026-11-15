// The app engine's web and picture tools on the studio's gateway (engine/enginetools.mjs, docs/engines/dyad.md):
// what each route answers, through stand-ins for Hermes's web tools, the site walk and the painter; that the
// gateway's key still guards them; and, where a runner is bundled, dyad's own tools calling them for real.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { engineTools, searchText, TOOL_ROUTES } from '../engine/enginetools.mjs'
import { hermesLlm } from '../engine/hermesllm.mjs'
import { publicUrl } from '../engine/chatmedia.mjs'
import { engineArgs, engineFresh, dyadDir, NO_ENV_FILE } from '../engine/appbuild.mjs'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d3a0f90000000049454e44ae426082', 'hex')
// stand-ins: Hermes's web tools (the bridge's /web answers), the guarded walk and the painter
function standIns({ walkNote = '' } = {}) {
  const asked = { web: [], walk: [], paint: [] }
  const dir = mkdtempSync(join(tmpdir(), 'swarm-tools-'))
  const pic = join(dir, 'pic.png')
  writeFileSync(pic, PNG)
  return {
    asked,
    web: async body => {
      asked.web.push(body)
      if (body.search) return { ok: true, res: { data: { web: [{ title: 'Boulder Club', url: 'https://boulder.example/', description: 'A climbing gym in Cornwall' }] } } }
      return { ok: true, res: { results: body.urls.map(url => ({ url, title: 'Boulder Club', content: '# Boulder Club\n\nClimbing in Cornwall.' })) } }
    },
    walk: async url => { asked.walk.push(url); return walkNote ? { pages: [], note: walkNote } : { pages: [{ url, shots: [JPEG] }] } },
    paint: async ({ prompt }) => { asked.paint.push(prompt); return { ok: true, path: pic } },
    check: url => publicUrl(url, { lookup: async host => [{ address: host.endsWith('.example') ? '93.184.216.34' : '10.0.0.7', family: 4 }] })
  }
}
// one route's answer, as the gateway writes it
async function call(tools, route, body) {
  const out = { status: 0, type: '', text: '' }
  const res = { headersSent: false, writeHead(s, h) { out.status = s; out.type = h['content-type']; this.headersSent = true; return this }, end(t) { out.text = String(t || '') } }
  await tools.answer(route, Buffer.from(JSON.stringify(body)), res)
  return out
}
// the text dyad's web_search reads out of the stream (tools/web_search.ts parseSSEEvents)
const sseText = s => s.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]').map(l => JSON.parse(l.slice(6)).choices?.[0]?.delta?.content || '').join('')

test('web-search: Hermes\'s search, as the stream dyad reads', async () => {
  const s = standIns(), tools = engineTools(s)
  const r = await call(tools, 'POST /llm/v1/tools/web-search', { query: 'climbing gyms in Cornwall' })
  assert.equal(r.status, 200)
  assert.equal(r.type, 'text/event-stream')
  assert.equal(sseText(r.text), searchText('climbing gyms in Cornwall', [{ title: 'Boulder Club', url: 'https://boulder.example/', description: 'A climbing gym in Cornwall' }]))
  assert.match(sseText(r.text), /1\. Boulder Club\n {3}https:\/\/boulder\.example\//)
  assert.deepEqual(s.asked.web, [{ search: 'climbing gyms in Cornwall', limit: 8 }])
  assert.equal((await call(tools, 'POST /llm/v1/tools/web-search', {})).status, 400)
})

test('web-crawl with markdownOnly (web_fetch): the page\'s text through Hermes, only from a public address', async () => {
  const s = standIns(), tools = engineTools(s)
  const r = await call(tools, 'POST /llm/v1/tools/web-crawl', { url: 'https://boulder.example/', markdownOnly: true })
  assert.equal(r.status, 200)
  assert.deepEqual(JSON.parse(r.text), { rootUrl: 'https://boulder.example/', markdown: '# Boulder Club\n\nClimbing in Cornwall.', pages: [{ url: 'https://boulder.example/', markdown: '# Boulder Club\n\nClimbing in Cornwall.' }] })
  assert.deepEqual(s.asked.walk, [], 'reading a page starts no browser')
  for (const url of ['https://intranet.corp/', 'http://127.0.0.1:4319/api/state', 'file:///etc/passwd', 'https://boulder.example:8080/']) {
    const no = await call(tools, 'POST /llm/v1/tools/web-crawl', { url, markdownOnly: true })
    assert.equal(no.status, 502, url)
    assert.match(JSON.parse(no.text).error.message, /public web pages|not a link|ordinary web links/, url)
  }
  assert.equal(s.asked.web.length, 1, 'nothing private was asked of Hermes')
})

test('web-crawl (clone a site): the page\'s text and one picture of it from the guarded walk', async () => {
  const s = standIns(), tools = engineTools(s)
  const r = await call(tools, 'POST /llm/v1/tools/web-crawl', { url: 'https://boulder.example/' })
  assert.equal(r.status, 200)
  const j = JSON.parse(r.text)
  assert.equal(j.rootUrl, 'https://boulder.example/')
  assert.match(j.markdown, /Climbing in Cornwall/)
  assert.equal(j.screenshot, `data:image/jpeg;base64,${JPEG.toString('base64')}`)
  assert.deepEqual(s.asked.walk, ['https://boulder.example/'])
  // no browser here: the walk's own plain words, not a picture-less clone
  const none = engineTools(standIns({ walkNote: 'Reading a site needs the film tools, which install with your first film.' }))
  const n = await call(none, 'POST /llm/v1/tools/web-crawl', { url: 'https://boulder.example/' })
  assert.equal(n.status, 502)
  assert.match(JSON.parse(n.text).error.message, /film tools/)
})

test('images/generations: the studio\'s painting, handed back as dyad expects', async () => {
  const s = standIns(), tools = engineTools(s)
  const r = await call(tools, 'POST /llm/v1/images/generations', { prompt: 'a chalk-dusted climbing hold', model: 'dyad/image-gen' })
  assert.equal(r.status, 200)
  const j = JSON.parse(r.text)
  assert.equal(typeof j.created, 'number')
  assert.equal(j.data[0].b64_json, PNG.toString('base64'))
  assert.deepEqual(s.asked.paint, ['a chalk-dusted climbing hold'])
  const fail = engineTools({ ...s, paint: async () => ({ ok: false, error: 'no image model' }) })
  assert.match(JSON.parse((await call(fail, 'POST /llm/v1/images/generations', { prompt: 'x' })).text).error.message, /no image model/)
})

test('the gateway answers the tool routes behind its own key, and still nothing else', async () => {
  const s = standIns()
  const llm = hermesLlm({ bridge: { status: () => ({ attached: false }) }, port: () => 0, token: 'studio-key', graceMs: 0, tools: engineTools(s) })
  const srv = createServer((req, res) => { if (!llm.handle(req, res)) res.writeHead(404).end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const at = p => `http://127.0.0.1:${srv.address().port}${p}`
  const post = (p, key, body = {}) => fetch(at(p), { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) })
  try {
    assert.deepEqual(TOOL_ROUTES, ['POST /llm/v1/tools/web-search', 'POST /llm/v1/tools/web-crawl', 'POST /llm/v1/images/generations'])
    for (const p of ['/llm/v1/tools/web-search', '/llm/v1/tools/web-crawl', '/llm/v1/images/generations']) {
      assert.equal((await post(p, null)).status, 401, p)
      assert.equal((await post(p, 'wrong')).status, 401, p)
    }
    assert.equal(s.asked.web.length + s.asked.paint.length, 0, 'nothing was asked without the key')
    assert.match(sseText(await (await post('/llm/v1/tools/web-search', 'studio-key', { query: 'gyms' })).text()), /Boulder Club/)
    assert.equal((await post('/llm/v1/tools/other', 'studio-key')).status, 404)
    assert.equal((await fetch(at('/llm/v1/tools/web-search'), { headers: { authorization: 'Bearer studio-key' } })).status, 404, 'POST only')
  } finally { srv.close() }
})

// ---------- dyad's own tools calling the routes: the runner, against a stand-in gateway that scripts the model
// and answers the tools with engineTools (stand-ins behind it). Swarm's own bundle when it is built from this
// source, or SWARM_ENGINE_BUNDLE (a bundle of the same tools, docs/engines/dyad.md).
const BUNDLE = process.env.SWARM_ENGINE_BUNDLE || (engineFresh() ? join(dyadDir, '.vite', 'build', 'aba_headless.cjs') : '')
const skip = BUNDLE && existsSync(BUNDLE) ? false : 'no app engine bundled here (a first app build bundles it; or set SWARM_ENGINE_BUNDLE)'

async function gateway(script, tools) {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const path = new URL(req.url, 'http://x').pathname, route = `${req.method} ${path}`
      if (req.headers.authorization !== 'Bearer k') return res.writeHead(401).end('{}')
      if (TOOL_ROUTES.includes(route)) { seen.push({ route, body }); return void tools.answer(route, Buffer.from(body), res) }
      if (!path.endsWith('/chat/completions')) return res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not here"}')
      const ask = JSON.parse(body || '{}')
      const results = (ask.messages || []).filter(m => m.role === 'tool').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      const reply = ask.tools?.length ? (script.length > 1 ? script.shift() : script[0]) : 'ok'
      if (ask.tools?.length) seen.push({ route: 'chat', tools: ask.tools.map(t => t.function?.name), results, users: (ask.messages || []).filter(m => m.role === 'user').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))) })
      const delta = typeof reply === 'string' ? { role: 'assistant', content: reply } : { role: 'assistant', tool_calls: [{ index: 0, id: `call_${results.length}`, type: 'function', function: { name: reply.tool, arguments: JSON.stringify(reply.args || {}) } }] }
      const finish = typeof reply === 'string' ? 'stop' : 'tool_calls'
      const chunk = (d, f = null) => ({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: ask.model, choices: [{ index: 0, delta: d, finish_reason: f }] })
      if (!ask.stream) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: ask.model, choices: [{ index: 0, message: delta, finish_reason: finish }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const c of [chunk(delta), chunk({}, finish), { ...chunk({}), choices: [], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }]) res.write(`data: ${JSON.stringify(c)}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return { seen, baseUrl: `http://127.0.0.1:${server.address().port}/llm/v1`, close: () => new Promise(r => server.close(r)) }
}
function tinyApp() {
  const root = mkdtempSync(join(tmpdir(), 'swarm-tools-run-')), app = join(root, 'app')
  mkdirSync(join(app, 'node_modules'), { recursive: true })
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'tiny', private: true, scripts: { build: 'node -e ""' } }))
  writeFileSync(join(app, '.gitignore'), 'node_modules\n')
  const g = (...a) => execFileSync('git', a, { cwd: app, stdio: 'ignore' })
  g('init', '-q'); g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-qm', 'init')
  return { root, app }
}
// one run of the runner: the model calls the tool once, then says it is done. → what the gateway saw, the app
async function runWith(call) {
  const s = standIns(), gw = await gateway([call, 'Done.'], engineTools(s))
  const { root, app } = tinyApp()
  const promptFile = join(root, 'prompt.md')
  writeFileSync(promptFile, 'Use the tool once, then stop.')
  const args = [BUNDLE, ...engineArgs({ promptFile, workspace: app, model: 'stub', gateway: gw.baseUrl, turns: 1, dataDir: join(root, 'data'), viewRender: false })]
  const p = spawn(process.execPath, args, { cwd: root, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot || '', HOME: process.env.HOME || root, USERPROFILE: process.env.USERPROFILE || root, ABA_API_KEY: 'k', ABA_ENV_FILE: NO_ENV_FILE, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { out += d })
  const killer = setTimeout(() => p.kill(), 150000)
  await new Promise(r => p.on('close', r))
  clearTimeout(killer)
  await gw.close()
  return { s, seen: gw.seen, app, out }
}
const resultOf = (seen, route) => seen.find(x => x.route === route)
const toolResults = seen => seen.filter(x => x.route === 'chat').flatMap(x => x.results)

test('the runner\'s web_search calls the gateway and the model reads Hermes\'s results', { skip, timeout: 200000 }, async () => {
  const r = await runWith({ tool: 'web_search', args: { query: 'climbing gyms in Cornwall' } })
  assert.ok(resultOf(r.seen, 'POST /llm/v1/tools/web-search'), r.out.slice(-800))
  assert.deepEqual(r.s.asked.web, [{ search: 'climbing gyms in Cornwall', limit: 8 }])
  assert.ok(toolResults(r.seen).some(t => /Boulder Club/.test(t)), r.out.slice(-800))
})
test('the runner\'s web_fetch reads a page through the gateway', { skip, timeout: 200000 }, async () => {
  const r = await runWith({ tool: 'web_fetch', args: { url: 'https://boulder.example/' } })
  assert.match(resultOf(r.seen, 'POST /llm/v1/tools/web-crawl')?.body || '', /"markdownOnly":true/, r.out.slice(-800))
  assert.ok(toolResults(r.seen).some(t => /Climbing in Cornwall/.test(t)), r.out.slice(-800))
})
test('the runner\'s web_crawl gets the page\'s text and its picture through the gateway', { skip, timeout: 200000 }, async () => {
  const r = await runWith({ tool: 'web_crawl', args: { url: 'https://boulder.example/' } })
  assert.ok(resultOf(r.seen, 'POST /llm/v1/tools/web-crawl'), r.out.slice(-800))
  assert.deepEqual(r.s.asked.walk, ['https://boulder.example/'])
  // dyad hands the clone instructions, the markdown and the picture to the model as the next user message
  assert.ok(r.seen.filter(x => x.route === 'chat').some(x => x.users.some(u => /Climbing in Cornwall/.test(u))), r.out.slice(-800))
})
test('the runner\'s generate_image paints through the gateway and keeps the picture in the app', { skip, timeout: 200000 }, async () => {
  const r = await runWith({ tool: 'generate_image', args: { prompt: 'a chalk-dusted climbing hold', title: 'hold' } })
  assert.ok(resultOf(r.seen, 'POST /llm/v1/images/generations'), r.out.slice(-800))
  assert.deepEqual(r.s.asked.paint, ['a chalk-dusted climbing hold'])
  const media = join(r.app, '.dyad', 'media')
  assert.ok(existsSync(media) && readdirSync(media).some(f => f.endsWith('.png')), r.out.slice(-800))
})
