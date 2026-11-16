// One picture through ckff's OpenAI-shaped image API (gpt-image-2.5 by default): the studio's
// fallback when no Hermes image provider is signed in or the signed-in one fails (Codex out of
// quota). The key is CKFF_API_KEY in this process's environment, which
// launcher.py fills from Hermes's secret scope. No file is read for it. It stays in this process
// and is never printed or logged.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'

export function ckffCreds(env = process.env) {
  const key = env.CKFF_API_KEY || ''
  const base = (env.CKFF_BASE_URL || 'https://ckffai.com/v1').replace(/\/$/, '')
  return key ? { key, base } : null
}

const SIZE = { landscape: '1536x1024', portrait: '1024x1536', square: '1024x1024' }
const mime = p => ({ '.png': 'image/png', '.webp': 'image/webp' }[extname(p).toLowerCase()] || 'image/jpeg')

// Centre-crop to W:H, the same box bridge.py `crop` takes for the Hermes path (a 16:9 cut-in, a 2:1 sky).
// It needs the image tools, which may not be installed: a picture at the wrong ratio is better than none, so a
// failure here returns the picture as it came.
async function cropTo(file, ratio, tools) {
  try {
    const w = Number(String(ratio).split(':')[0]), h = Number(String(ratio).split(':')[1])
    if (!(w > 0 && h > 0)) return file
    const t = await tools?.()
    if (!t?.Transformer) return file
    const want = w / h, meta = await new t.Transformer(readFileSync(file)).metadata()
    const [iw, ih] = [meta.width, meta.height]
    if (!iw || !ih) return file
    const box = iw / ih > want
      ? { x: Math.floor((iw - Math.round(ih * want)) / 2), y: 0, width: Math.round(ih * want), height: ih }
      : { x: 0, y: Math.floor((ih - Math.round(iw / want)) / 2), width: iw, height: Math.round(iw / want) }
    const out = join(dirname(file), `cropped-${String(ratio).replace(':', 'x')}.png`)
    writeFileSync(out, await new t.Transformer(readFileSync(file)).crop(box.x, box.y, box.width, box.height).png())
    return out
  } catch { return file }
}

// -> { ok, path, model } or { ok: false, error }
export async function ckffPaint({ prompt, aspect = 'landscape', refs = [], crop = '', tools = null, model = process.env.CKFF_MODEL || 'gpt-image-2.5', fetchImpl = fetch, timeoutMs = 300000 } = {}) {
  const c = ckffCreds()
  if (!c) return { ok: false, error: 'no ckff key' }
  const pics = refs.filter(r => r && existsSync(r)).slice(0, 4)
  // With no picture attached, a prompt that happens to say "repair", "fix" or "edit" (a game item
  // that "charges the repair") was taken upstream for an edit request and refused with "please
  // upload the image to edit". Saying it is a new picture up front stops that.
  const lead = pics.length ? '' : 'Paint a new picture from this description. Nothing is uploaded and nothing is being edited. '
  const body = { model, size: SIZE[aspect] || SIZE.landscape, prompt: (lead + String(prompt)).slice(0, 3800) }
  let url = `${c.base}/images/generations`
  if (pics.length) {
    url = `${c.base}/images/edits`
    const im = pics.map(r => `data:${mime(r)};base64,${readFileSync(r).toString('base64')}`)
    body.image = im.length === 1 ? im[0] : im
  }
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${c.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    const j = await r.json().catch(() => ({}))
    const b64 = j.data?.[0]?.b64_json
    if (!r.ok || !b64) return { ok: false, error: `ckff HTTP ${r.status}: ${String(j.error?.message || j.error || '').slice(0, 160)}` }
    let out = join(mkdtempSync(join(tmpdir(), 'swarm-ckff-')), 'image.png')
    writeFileSync(out, Buffer.from(b64, 'base64'))
    // the crop the Hermes path takes in bridge.py, so a cut-in is the shape its slot asks for
    if (crop) out = await cropTo(out, crop, tools)
    return { ok: true, path: out, model: `ckff/${model}` }
  } catch (err) {
    return { ok: false, error: `ckff: ${String(err?.message || err).slice(0, 160)}` }
  }
}
