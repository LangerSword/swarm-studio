// The server's token travels only in the x-swarm-token header, never as ?k= in an address (catalog review of
// e8ae13c4): web/headerstream.js reads the event stream, the autoplay picture stream and downloads with fetch, and
// the server refuses ?k=.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sseEvents, multipartFrames, eventStream, frameStream, download, TOKEN_HEADER } from '../web/headerstream.js'
import { startStudio } from '../scripts/studio-child.mjs'

const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r({ s, base: `http://127.0.0.1:${s.address().port}` })) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (ok, ms = 3000) => { for (const t0 = Date.now(); !ok() && Date.now() - t0 < ms;) await wait(20); return ok() }

test('an event stream is read as EventSource reads it: data lines, comments skipped, the rest kept', () => {
  assert.deepEqual(sseEvents(': hello\n\ndata: {"a":1}\n\ndata: two\ndata: lines\n\ndata: {"b"'), { events: ['{"a":1}', 'two\nlines'], rest: 'data: {"b"' })
  assert.deepEqual(sseEvents('data:x\r\n\r\nevent: ping\nid: 3\n\n'), { events: ['x'], rest: '' })
})

test('a picture stream is cut by each part\'s content-length, whatever bytes the picture holds', () => {
  const part = (body, type = 'image/jpeg') => Buffer.concat([Buffer.from(`--b\r\ncontent-type: ${type}\r\ncontent-length: ${body.length}\r\n\r\n`), body, Buffer.from('\r\n')])
  const a = Buffer.from([0xff, 0xd8, 13, 10, 13, 10, 0xff, 0xd9]), b = Buffer.from('second')
  const all = new Uint8Array(Buffer.concat([part(a), part(b, 'image/png')]))
  const got = multipartFrames(all)
  assert.deepEqual(got.frames.map(f => [f.type, Buffer.from(f.body).toString('hex')]), [['image/jpeg', a.toString('hex')], ['image/png', b.toString('hex')]])
  const cut = multipartFrames(all.slice(0, 30))
  assert.equal(cut.frames.length, 0, 'a part not all here yet waits')
  assert.equal(cut.rest.length, 30)
})

test('the event stream sends the token in its header, never the address, and opens again when it ends', async () => {
  const seen = []
  const { s, base } = await listen((req, res) => {
    seen.push({ url: req.url, token: req.headers[TOKEN_HEADER] })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`: hello\n\ndata: ${JSON.stringify({ n: seen.length })}\n\n`)
  })
  const got = []
  const es = eventStream(`${base}/events`, { token: 'secret', retryMs: 50, onMessage: m => got.push(JSON.parse(m.data).n) })
  try {
    await es.opened
    assert.ok(await until(() => got.length >= 2), `it opened again (${got})`)
    assert.deepEqual(got.slice(0, 2), [1, 2])
    assert.ok(seen.every(r => r.url === '/events' && r.token === 'secret'), JSON.stringify(seen))
  } finally { es.close(); s.close() }
  const n = got.length
  await wait(200)
  assert.ok(got.length <= n + 1, 'closed: it stops asking')
})

test('the picture stream and a download send the token in the header too', async () => {
  const seen = []
  const { s, base } = await listen((req, res) => {
    seen.push({ url: req.url, token: req.headers[TOKEN_HEADER] })
    if (req.url.startsWith('/stream')) {
      res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=b' })
      const body = Buffer.from('jpegbytes')
      res.write(`--b\r\ncontent-type: image/jpeg\r\ncontent-length: ${body.length}\r\n\r\n`)
      res.end(Buffer.concat([body, Buffer.from('\r\n--b--\r\n')]))
    } else res.writeHead(200, { 'content-type': 'application/zip' }).end('zip!')
  })
  try {
    const frames = []
    let ended = false
    frameStream(`${base}/stream?t=1`, { token: 'secret', onFrame: b => frames.push(b), onEnd: () => { ended = true } })
    assert.ok(await until(() => ended))
    assert.equal(frames.length, 1)
    assert.equal(await frames[0].text(), 'jpegbytes')
    assert.equal(frames[0].type, 'image/jpeg')
    // a download: fetched with the header, then saved through a link to a blob URL
    const clicked = []
    const doc = { body: { append: () => {} }, createElement: () => ({ click() { clicked.push({ href: this.href, name: this.download }) }, remove() {} }) }
    await download(`${base}/export.zip`, { token: 'secret', name: 'build.zip', doc })
    assert.equal(clicked.length, 1)
    assert.match(clicked[0].href, /^blob:/)
    assert.equal(clicked[0].name, 'build.zip')
    assert.ok(seen.every(r => r.token === 'secret' && !/[?&]k=/.test(r.url)), JSON.stringify(seen))
    await assert.rejects(download(`${base}/nope`, { token: 'secret', name: 'x', doc, fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/)
  } finally { s.close() }
})

test('the server takes its token only in the header: ?k= is refused', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'token-'))
  mkdirSync(join(dir, 'data', 'runs'), { recursive: true })
  const env = { ...process.env, SWARM_TOKEN: 't0ken', SWARM_DATA_DIR: join(dir, 'data'), SWARM_RUNS_DIR: join(dir, 'data', 'runs'), SWARM_OUTPUT_DIR: join(dir, 'out'), HERMES_HOME: join(dir, 'hermes') }
  const { child, exited, base } = await startStudio({ env })
  try {
    assert.equal((await fetch(`${base}/api/projects?k=t0ken`)).status, 401, 'the token in the address does nothing')
    assert.equal((await fetch(`${base}/api/projects`)).status, 401)
    assert.equal((await fetch(`${base}/api/projects`, { headers: { [TOKEN_HEADER]: 't0ken' } })).status, 200)
    const ctl = new AbortController()
    assert.equal((await fetch(`${base}/events?k=t0ken`, { signal: ctl.signal })).status, 401, 'nor for the event stream')
    const ok = await fetch(`${base}/events`, { headers: { [TOKEN_HEADER]: 't0ken' }, signal: ctl.signal })
    assert.equal(ok.status, 200)
    ctl.abort()
  } finally { child.kill(); await exited; rmSync(dir, { recursive: true, force: true }) }
})
