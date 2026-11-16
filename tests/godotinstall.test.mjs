// "Install Godot 4" really installs it (engine/godotinstall.mjs), with everything that reaches outside stood in:
// no download, no brew and no Godot run here. The real release's sums are only read, never fetched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { GODOT, TEMPLATES, fileFor, installGodot, installTemplates, ownGodot, ownTemplates, templatesRoot, templatesFolder, godotJob, godotHome, brewOf, versionOf } from '../engine/godotinstall.mjs'
import { godotBin } from '../engine/port.mjs'
import { installLine } from '../engine/gamestep.mjs'

const BODY = Buffer.from('not a real archive, only its bytes')
const sum = b => createHash('sha512').update(b).digest('hex')
// a small release of the same shape as the pinned one
const RELEASE = { version: '4.7.2', base: 'https://github.com/godotengine/godot/releases/download/4.7.2-stable/', files: {
  darwin: { name: 'Godot_v4.7.2-stable_macos.universal.zip', size: BODY.length, bin: 'Godot.app/Contents/MacOS/Godot', sha512: sum(BODY) },
  'linux-x64': { name: 'Godot_v4.7.2-stable_linux.x86_64.zip', size: BODY.length, bin: 'Godot_v4.7.2-stable_linux.x86_64', sha512: sum(BODY) }
} }
const answer = (body = BODY, status = 200) => async () => new Response(body, { status })
// what unpacking would leave: the program at its place in the folder
const unpackAs = rel => async (zip, to) => { mkdirSync(join(to, rel, '..'), { recursive: true }); writeFileSync(join(to, rel), '#!/bin/sh\n'); return true }
const RAN = async (cmd, args) => (args[0] === '--version' ? { ok: true, out: '4.7.2.stable.official.abc123\n' } : { ok: true, out: '' })
// the templates are their own install (below): these tests stand them in, so no test reads the machine's own
// Godot folder — a developer who has Godot installed would otherwise change what the editor tests do
const NO_TPL = async () => ({ ok: true, mb: 0 })
const temp = () => mkdtempSync(join(tmpdir(), 'godot-'))
const left = dir => (existsSync(godotHome(dir)) ? readdirSync(godotHome(dir)) : [])

test('the pinned release: one 4.x stable, a file and a published SHA-512 for each platform', () => {
  assert.match(GODOT.version, /^4\.\d+(\.\d+)?$/)
  assert.ok(GODOT.base.startsWith('https://github.com/godotengine/godot/releases/download/') && GODOT.base.endsWith(`${GODOT.version}-stable/`))
  for (const [k, f] of Object.entries(GODOT.files)) {
    assert.match(f.sha512, /^[0-9a-f]{128}$/, k)
    assert.ok(f.name.includes(`v${GODOT.version}-stable`) && f.name.endsWith('.zip') && f.size > 5e7, k)
  }
  assert.equal(fileFor('darwin', 'arm64'), fileFor('darwin', 'x64'))
  assert.equal(fileFor('linux', 'x64').name, 'Godot_v4.7.2-stable_linux.x86_64.zip')
  assert.equal(fileFor('freebsd', 'x64'), null)
})

test('installed from the archive: checked, unpacked into the data folder, run, and found from there', async () => {
  const dir = temp()
  try {
    const seen = [], urls = []
    const r = await installGodot({ dataDir: dir, platform: 'darwin', arch: 'arm64', release: RELEASE, exists: () => false, runner: RAN, unpack: unpackAs(RELEASE.files.darwin.bin),
      fetchImpl: async url => { urls.push(url); return new Response(BODY) }, onProgress: p => seen.push(p), templates: NO_TPL })
    assert.deepEqual([r.ok, r.route, r.version], [true, 'archive', '4.7.2'])
    assert.deepEqual(urls, ['https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_macos.universal.zip'])
    assert.equal(r.bin, join(dir, 'godot', '4.7.2', 'Godot.app', 'Contents', 'MacOS', 'Godot'))
    assert.ok(r.bin.startsWith(dir + sep), 'nothing outside the data folder')
    assert.equal(ownGodot(dir), r.bin)
    assert.deepEqual(left(dir).sort(), ['4.7.2', 'current.json'], 'the archive and the work folder are gone')
    assert.equal(JSON.parse(readFileSync(join(dir, 'godot', 'current.json'), 'utf8')).sha512, RELEASE.files.darwin.sha512)
    assert.deepEqual(seen[0], { route: 'archive', mb: 0, pct: 0 })
    assert.equal(seen.at(-1).pct, 100)
    // every Godot caller finds it: the person's own first, then this one (engine/port.mjs godotBin)
    assert.equal(godotBin({ SWARM_DATA_DIR: dir, PATH: '' }, []), r.bin)
    assert.equal(godotBin({ SWARM_DATA_DIR: temp(), PATH: '' }, []), null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a download that is not the published file is thrown away before anything opens it', async () => {
  for (const body of [Buffer.from('not a real archive, only its bytez'), Buffer.concat([BODY, BODY]), BODY.subarray(0, 9)]) {
    const dir = temp()
    let unpacked = 0
    const r = await installGodot({ dataDir: dir, platform: 'linux', arch: 'x64', release: RELEASE, runner: RAN, fetchImpl: answer(body), unpack: async () => { unpacked++; return true }, templates: NO_TPL })
    assert.deepEqual(r, { ok: false, route: 'archive', why: 'the download did not match the checksum Godot published, so it was thrown away' })
    assert.equal(unpacked, 0)
    assert.deepEqual(left(dir), [])
    assert.equal(ownGodot(dir), null)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no network, a refusal, a computer with no download, a program that does not start: each a plain reason', async () => {
  const dir = temp()
  try {
    const base = { dataDir: dir, platform: 'linux', arch: 'x64', release: RELEASE, runner: RAN, unpack: unpackAs(RELEASE.files['linux-x64'].bin) }
    let r = await installGodot({ ...base, fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) }, templates: NO_TPL })
    assert.deepEqual(r, { ok: false, route: 'archive', why: 'this computer could not reach github.com' })
    r = await installGodot({ ...base, fetchImpl: answer('gone', 404), templates: NO_TPL })
    assert.equal(r.why, 'github.com answered 404 for the download')
    r = await installGodot({ ...base, platform: 'freebsd', fetchImpl: () => assert.fail('nothing to fetch'), templates: NO_TPL })
    assert.deepEqual(r, { ok: false, route: 'none', why: 'Godot has no download for this kind of computer: get it from godotengine.org, then press Check again' })
    r = await installGodot({ ...base, fetchImpl: answer(), unpack: async () => false, templates: NO_TPL })
    assert.equal(r.why, 'the download could not be unpacked on this computer')
    r = await installGodot({ ...base, fetchImpl: answer(), runner: async () => ({ ok: false, out: 'cannot execute binary file' }), templates: NO_TPL })
    assert.equal(r.why, 'the downloaded Godot did not start on this computer')
    assert.deepEqual(left(dir), [], 'nothing half-installed is left')
    for (const x of [r.why]) assert.doesNotMatch(x, /Error|ENO|stack|undefined/)
    // found on Linux by its own name in the archive
    r = await installGodot({ ...base, fetchImpl: answer(), templates: NO_TPL })
    assert.equal(r.bin, join(dir, 'godot', '4.7.2', 'Godot_v4.7.2-stable_linux.x86_64'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Homebrew on a Mac: used when it is there, skipped when it is not, refused when it wants a password', async () => {
  const dir = temp()
  try {
    const APP = '/Applications/Godot.app/Contents/MacOS/Godot'
    const base = { dataDir: dir, platform: 'darwin', arch: 'arm64', release: RELEASE, unpack: unpackAs(RELEASE.files.darwin.bin) }
    // found only off PATH, where an app opened from the Dock has it (#405)
    assert.equal(brewOf({ PATH: '/usr/bin:/bin' }, f => f === '/opt/homebrew/bin/brew'), '/opt/homebrew/bin/brew')
    assert.equal(brewOf({ PATH: '/usr/bin:/bin' }, () => false), null)

    // brew there and it works: nothing is downloaded by the Studio
    let calls = []
    let r = await installGodot({ ...base, exists: f => f === '/opt/homebrew/bin/brew', find: () => APP, fetchImpl: () => assert.fail('no download when brew installed it'),
      runner: async (cmd, args, opts) => { calls.push([cmd, args, opts?.env]); return RAN(cmd, args) }, templates: NO_TPL })
    assert.deepEqual([r.ok, r.route, r.bin, r.version], [true, 'brew', APP, '4.7.2'])
    assert.deepEqual(calls[0].slice(0, 2), ['/opt/homebrew/bin/brew', ['install', '--cask', 'godot']])
    // no terminal and an askpass that always fails: a password is never asked for
    assert.equal(calls[0][2].SUDO_ASKPASS, '/usr/bin/false')
    assert.ok(!calls.some(c => c[0] === 'sudo' || c[1].includes('sudo')))

    // brew missing: the archive, and brew is never run
    calls = []
    r = await installGodot({ ...base, exists: () => false, fetchImpl: answer(), runner: async (cmd, args) => { calls.push(cmd); return RAN(cmd, args) }, templates: NO_TPL })
    assert.deepEqual([r.ok, r.route, r.note], [true, 'archive', undefined])
    assert.ok(!calls.some(c => /brew/.test(c)))

    // brew wants a password: refused, said, and the archive instead (into the data folder, no password)
    r = await installGodot({ ...base, exists: f => f === '/usr/local/bin/brew', find: () => null, fetchImpl: answer(),
      runner: async (cmd, args) => (/brew$/.test(cmd) ? { ok: false, out: 'sudo: no password was provided\nsudo: a password is required' } : RAN(cmd, args)), templates: NO_TPL })
    assert.deepEqual([r.ok, r.route, r.note], [true, 'archive', 'Homebrew asked for a password, so Godot came from its own releases.'])
    assert.ok(r.bin.startsWith(dir + sep))
    // brew failed another way and the archive fails too: the archive's reason, no note
    r = await installGodot({ ...base, exists: f => f === '/usr/local/bin/brew', find: () => null, fetchImpl: async () => { throw new Error('offline') }, runner: async () => ({ ok: false, out: 'Error: Download failed' }), templates: NO_TPL })
    assert.deepEqual(r, { ok: false, route: 'archive', why: 'this computer could not reach github.com' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('"installed" means it ran as Godot 4', async () => {
  assert.equal(await versionOf('g', async () => ({ ok: true, out: '4.7.2.stable.official.abc\n' })), '4.7.2')
  assert.equal(await versionOf('g', async () => ({ ok: true, out: 'warning: x\n4.6.stable.mono\n' })), '4.6')
  assert.equal(await versionOf('g', async () => ({ ok: true, out: '3.6.3.stable.official\n' })), null)
  assert.equal(await versionOf('g', async () => ({ ok: false, out: '' })), null)
})

test('one install at a time, and the chat\'s line says where it is', async () => {
  let release, n = 0
  const job = godotJob({ install: ({ onProgress }) => { n++; onProgress({ route: 'archive', mb: 171, pct: 0 }); return new Promise(r => { release = () => { onProgress({ pct: 40 }); r({ ok: true, version: '4.7.2' }) } }) } })
  assert.deepEqual(job.state(), { state: 'idle' })
  const a = job.start(), b = job.start()
  assert.equal(a, b)
  assert.equal(job.busy(), true)
  await new Promise(r => setTimeout(r, 5))
  assert.equal(n, 1)
  assert.equal(installLine(job.state()), 'Installing Godot 4 now: 171 MB from Godot\'s releases.')
  assert.equal(installLine({ route: 'archive', mb: 171, pct: 40 }), 'Installing Godot 4 now: 171 MB from Godot\'s releases (40%).')
  assert.equal(installLine({ route: 'brew', pct: 40 }), 'Installing Godot 4 now, with Homebrew.')
  assert.equal(installLine({}), 'Installing Godot 4 now.')
  release()
  assert.deepEqual(await a, { ok: true, version: '4.7.2' })
  assert.deepEqual([job.busy(), job.state()], [false, { state: 'done', version: '4.7.2' }])
  // an installer that throws is a failure with a plain reason, and the next press starts again
  const bad = godotJob({ install: async () => { throw new Error('EACCES: /x') } })
  assert.deepEqual(await bad.start(), { ok: false, route: 'none', why: 'Godot could not be installed here' })
  assert.equal(bad.state().state, 'failed')
})

// ---------- the Web export templates: the release's own .tpz, checked, then only the Web ones kept
const TPZ = Buffer.from('a tpz, in bytes')
const sumOf = b => createHash('sha512').update(b).digest('hex')
// the same shape as the release: a zip of `templates/…`, with the two the Web preset needs
const tplRelease = () => ({ version: '4.7.2', base: 'https://github.com/godotengine/godot/releases/download/4.7.2-stable/' })
const tplTEMPLATES = { ...TEMPLATES, size: TPZ.length, sha512: sumOf(TPZ) }
// unpacking leaves the archive's own layout: `templates/web_nothreads_*.zip` and `templates/version.txt`
const unpackTpl = (names = ['web_nothreads_debug.zip', 'web_nothreads_release.zip', 'version.txt', 'android_debug.apk']) => async (zip, to) => {
  mkdirSync(join(to, 'templates'), { recursive: true })
  for (const n of names) writeFileSync(join(to, 'templates', n), `the ${n}`)
  return true
}

test('the Web export templates: the release\'s own file, its published sum, and only the Web ones kept', async () => {
  const dir = temp(), root = join(dir, 'godot-templates')
  try {
    const urls = [], seen = []
    const r = await installTemplates({ dataDir: dir, platform: 'darwin', root, release: tplRelease(), TEMPLATES: tplTEMPLATES,
      fetchImpl: async url => { urls.push(url); return new Response(TPZ) }, unpack: unpackTpl(), onProgress: p => seen.push(p) })
    assert.equal(r.ok, true, JSON.stringify(r))
    // the pinned release's own file, from the release itself
    assert.deepEqual(urls, ['https://github.com/godotengine/godot/releases/download/4.7.2-stable/Godot_v4.7.2-stable_export_templates.tpz'])
    // where Godot looks: export_templates/<version>.stable/
    assert.equal(r.dir, join(root, '4.7.2.stable'))
    assert.deepEqual(readdirSync(join(root, '4.7.2.stable')).sort(), ['version.txt', 'web_nothreads_debug.zip', 'web_nothreads_release.zip'])
    // the 1.28 GB archive is not kept: the work folder it came down in is gone, and the templates are where
    // Godot looks, not in the Studio's folder
    assert.deepEqual(left(dir), [], 'nothing of the download is left in the data folder')
    assert.equal(readdirSync(join(root, '4.7.2.stable')).some(n => /\.tpz$/.test(n)), false, 'the archive is not kept')
    assert.equal(ownTemplates('4.7.2', { root }), true)
    assert.equal(seen[0].route, 'templates')
    assert.equal(seen.at(-1).pct, 100)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('templates that are not the published file are thrown away, and nothing is written where Godot looks', async () => {
  const dir = temp(), root = join(dir, 'godot-templates')
  try {
    const r = await installTemplates({ dataDir: dir, platform: 'darwin', root, release: tplRelease(), TEMPLATES: tplTEMPLATES,
      fetchImpl: async () => new Response(Buffer.from('not the release')), unpack: unpackTpl() })
    assert.equal(r.ok, false)
    assert.match(r.why, /did not match the checksum/)
    assert.equal(ownTemplates('4.7.2', { root }), false)
    assert.equal(existsSync(join(root, '4.7.2.stable')), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a download that stops part way is a plain reason, and no templates are left behind', async () => {
  const dir = temp(), root = join(dir, 'godot-templates')
  try {
    const short = TPZ.subarray(0, 3)
    const r = await installTemplates({ dataDir: dir, platform: 'darwin', root, release: tplRelease(), TEMPLATES: tplTEMPLATES,
      fetchImpl: async () => new Response(short), unpack: unpackTpl() })
    assert.equal(r.ok, false)
    assert.match(r.why, /did not match the checksum|stopped before it finished/)
    assert.equal(ownTemplates('4.7.2', { root }), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('templates already there are left alone: no second download', async () => {
  const dir = temp(), root = join(dir, 'godot-templates')
  try {
    const to = join(root, '4.7.2.stable')
    mkdirSync(to, { recursive: true })
    for (const n of ['web_nothreads_debug.zip', 'web_nothreads_release.zip']) writeFileSync(join(to, n), 'the person put these here')
    const r = await installTemplates({ dataDir: dir, platform: 'darwin', root, release: tplRelease(), TEMPLATES: tplTEMPLATES,
      fetchImpl: () => assert.fail('nothing to fetch when the templates are there'), unpack: async () => assert.fail('nothing to unpack') })
    assert.equal(r.ok, true)
    assert.equal(r.mb, 0)
    assert.match(r.note, /already there/)
    assert.equal(readFileSync(join(to, 'web_nothreads_release.zip'), 'utf8'), 'the person put these here')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('where Godot looks for templates, on each kind of computer', () => {
  // the separators are the running computer's, so the paths are built the same way the code builds them
  assert.equal(templatesRoot({ platform: 'darwin', home: join('/', 'Users', 'me') }), join('/', 'Users', 'me', 'Library', 'Application Support', 'Godot', 'export_templates'))
  assert.equal(templatesRoot({ platform: 'linux', home: join('/', 'home', 'me'), env: {} }), join('/', 'home', 'me', '.local', 'share', 'godot', 'export_templates'))
  assert.equal(templatesRoot({ platform: 'linux', home: join('/', 'home', 'me'), env: { XDG_DATA_HOME: join('/', 'd') } }), join('/', 'd', 'godot', 'export_templates'))
  // Windows: %APPDATA% when it is set, else the same place under the home folder
  assert.equal(templatesRoot({ platform: 'win32', home: 'C:\\Users\\me', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } }), join('C:\\Users\\me\\AppData\\Roaming', 'Godot', 'export_templates'))
  assert.equal(templatesRoot({ platform: 'win32', home: 'C:\\Users\\me', env: {} }), join('C:\\Users\\me', 'AppData', 'Roaming', 'Godot', 'export_templates'))
  // the folder Godot reads is named after the version its own version.txt holds
  assert.equal(templatesFolder('4.7.2', join('/', 'r')), join('/', 'r', '4.7.2.stable'))
})

test('the editor installs without them, and says so: a Web export then fails for one reason', async () => {
  const dir = temp(), root = join(dir, 'godot-templates')
  try {
    const r = await installGodot({ dataDir: dir, platform: 'darwin', arch: 'arm64', release: RELEASE, exists: () => false, runner: RAN, unpack: unpackAs(RELEASE.files.darwin.bin),
      fetchImpl: async () => new Response(BODY), templates: async () => ({ ok: false, why: 'this computer could not reach github.com' }) })
    // the editor is installed and works: the templates are a second download that failed, not a failed install
    assert.deepEqual([r.ok, r.version], [true, '4.7.2'])
    assert.deepEqual(r.templates, { ok: false, why: 'this computer could not reach github.com' })
    assert.ok(existsSync(r.bin))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
