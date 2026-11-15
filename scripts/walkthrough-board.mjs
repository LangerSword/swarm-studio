// The walkthrough as one board (docs/ux/walkthrough): every flow a strip of its screens in order, each
// picture with what breaks the owner's text rules marked on it: full sentences at rest, internal words,
// raw errors, and controls found only by hovering. The count of words on the screen is in its caption.
//
//   node scripts/walkthrough-board.mjs [--out docs/ux/walkthrough] [--marked]
//
// Writes <out>/board.html. With --marked it also writes <out>/marked/<picture>.jpg, each picture with its
// marks painted in, for a design tool that takes pictures only (needs Playwright, as scripts/walkthrough.mjs).
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const OUT = resolve(ROOT, arg('out', 'docs/ux/walkthrough'))
const shots = JSON.parse(readFileSync(join(OUT, 'shots.json'), 'utf8'))
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// what is marked, and the one letter that names it on the picture
const KINDS = [['sentences', 'T', 'Sentence at rest'], ['internal', 'I', 'Internal word'], ['raw', 'E', 'Raw error'], ['hover', 'H', 'Only on hover'], ['tips', 'P', 'Tooltip']]
function marks(s) {
  const a = s.audit || {}
  return KINDS.flatMap(([k, letter]) => (a[k] || []).map(f => ({ k, letter, box: f.box, text: f.text || f.tip || (f.shows || []).join(', ') || f.label || '' })))
}
const pct = (v, of) => `${(v / of * 100).toFixed(2)}%`
function figure(s) {
  if (!s.reached) return `<figure class="miss ${s.width}"><div class="im"></div><figcaption><b>${esc(s.title)}</b><span>Not reached: ${esc(s.why)}</span></figcaption></figure>`
  const ms = marks(s).map(m => { const [x, y, w, h] = m.box; return `<i class="mk ${m.k}" style="left:${pct(x, s.w)};top:${pct(y, s.h)};width:${pct(Math.max(w, 8), s.w)};height:${pct(Math.max(h, 8), s.h)}"><b>${m.letter}</b></i>` }).join('')
  const n = k => (s.audit?.[k] || []).length
  const facts = [`${s.audit?.words ?? 0} words`, n('sentences') && `${n('sentences')} sentences`, n('internal') && `${n('internal')} internal`, n('raw') && `${n('raw')} raw`, n('hover') && `${n('hover')} hover-only`, n('tips') && `${n('tips')} tooltips`].filter(Boolean).join(' · ')
  return `<figure class="${s.width}" id="${s.width}-${esc(s.id)}"><div class="im"><img loading="lazy" src="${esc(s.file)}" alt="${esc(s.title)}">${ms}</div><figcaption><b>${esc(s.title)}</b><span>${facts}</span></figcaption></figure>`
}
const flows = []
for (const s of shots) { let f = flows.find(x => x.name === s.flow); if (!f) flows.push(f = { name: s.flow, desk: [], phone: [] }); f[s.width]?.push(s) }
const strip = (f, w) => f[w].length ? `<div class="strip">${f[w].sort((a, b) => a.n - b.n).map(figure).join('<span class="to"></span>')}</div>` : ''
const css = `:root{color-scheme:dark}body{margin:0;background:#111113;color:#e8e8ea;font:14px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;left:0;z-index:2;background:#111113;border-bottom:1px solid #2a2a2d;padding:12px 24px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
header h1{font-size:16px;margin:0 12px 0 0}header span{display:inline-flex;gap:6px;align-items:center;color:#b4b4b8}
section{padding:28px 24px 8px}h2{font-size:20px;margin:0 0 14px}
.strip{display:flex;align-items:flex-start;overflow-x:auto;padding:0 0 22px}
.to{flex:0 0 28px;height:2px;background:#4a4a4f;margin-top:140px}
figure{margin:0;flex:0 0 auto}figure.desk{width:560px}figure.phone{width:200px}
.im{position:relative;border:1px solid #2f2f33;border-radius:6px;overflow:hidden;background:#1b1b1e}.miss .im{height:120px}
img{display:block;width:100%}figcaption{padding:8px 2px 0;display:grid;gap:2px}figcaption span{color:#9a9a9f;font-size:12px}
.mk{position:absolute;box-sizing:border-box;border:2px solid #f2b34c;border-radius:3px}.mk b{position:absolute;left:-2px;top:-16px;font:700 10px system-ui;background:#f2b34c;color:#111;padding:1px 4px;border-radius:3px}
.mk.raw,.mk.raw b{border-color:#ef6b5e}.mk.raw b{background:#ef6b5e}.mk.hover,.mk.hover b{border-color:#fff}.mk.hover b{background:#fff}
.k{display:inline-block;font:700 10px system-ui;background:#f2b34c;color:#111;padding:1px 5px;border-radius:3px}.k.raw{background:#ef6b5e}.k.hover{background:#fff}
body.plain .mk{display:none}button{font:inherit;background:#232326;color:inherit;border:1px solid #3a3a3e;border-radius:6px;padding:6px 12px;min-height:40px;cursor:pointer}`
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio walkthrough board</title><style>${css}</style>
<header><h1>Studio walkthrough board</h1>${KINDS.map(([k, l, name]) => `<span><i class="k ${k}">${l}</i>${name}</span>`).join('')}<button onclick="document.body.classList.toggle('plain')">Marks</button></header>
${flows.map(f => `<section><h2>${esc(f.name)}</h2>${strip(f, 'desk')}${strip(f, 'phone')}</section>`).join('\n')}`
writeFileSync(join(OUT, 'board.html'), html)
console.log(`board.html: ${flows.length} flows, ${shots.length} pictures`)

if (process.argv.includes('--marked')) {
  const load = async () => { try { return await import('playwright') } catch {} const req = createRequire(join(resolve(process.env.PLAYWRIGHT_DIR || '.'), 'package.json')); try { return req('playwright') } catch { return req('playwright-core') } }
  const { chromium } = await load()
  mkdirSync(join(OUT, 'marked'), { recursive: true })
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(join(OUT, 'board.html')).href)
  await page.addStyleTag({ content: 'figure{width:auto!important}figure.desk .im{width:1440px}figure.phone .im{width:390px}img{content-visibility:visible}' })
  for (const s of shots.filter(x => x.reached)) {
    const el = page.locator(`#${s.width}-${s.id} .im`)
    await el.scrollIntoViewIfNeeded()
    await el.locator('img').evaluate(i => i.complete || new Promise(r => { i.onload = i.onerror = r }))
    await el.screenshot({ path: join(OUT, 'marked', s.file.replace(/^img\//, '')), type: 'jpeg', quality: 70 })
  }
  await browser.close()
  console.log('marked/: done')
}
