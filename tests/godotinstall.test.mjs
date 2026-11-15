// "Install Godot 4" really installs it (engine/godotinstall.mjs), with everything that reaches outside stood in:
// no download, no brew and no Godot run here. The real release's sums are only read, never fetched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { GODOT, fileFor, installGodot, ownGodot, godotJob, godotHome, brewOf, versionOf } from '../engine/godotinstall.mjs'
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
      fetchImpl: async url => { urls.push(url); return new Response(BODY) }, onProgress: p => seen.push(p) })
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
    const r = await installGodot({ dataDir: dir, platform: 'linux', arch: 'x64', release: RELEASE, runner: RAN, fetchImpl: answer(body), unpack: async () => { unpacked++; return true } })
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
    let r = await installGodot({ ...base, fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) } })
    assert.deepEqual(r, { ok: false, route: 'archive', why: 'this computer could not reach github.com' })
    r = await installGodot({ ...base, fetchImpl: answer('gone', 404) })
    assert.equal(r.why, 'github.com answered 404 for the download')
    r = await installGodot({ ...base, platform: 'freebsd', fetchImpl: () => assert.fail('nothing to fetch') })
    assert.deepEqual(r, { ok: false, route: 'none', why: 'Godot has no download for this kind of computer: get it from godotengine.org, then press Check again' })
    r = await installGodot({ ...base, fetchImpl: answer(), unpack: async () => false })
    assert.equal(r.why, 'the download could not be unpacked on this computer')
    r = await installGodot({ ...base, fetchImpl: answer(), runner: async () => ({ ok: false, out: 'cannot execute binary file' }) })
    assert.equal(r.why, 'the downloaded Godot did not start on this computer')
    assert.deepEqual(left(dir), [], 'nothing half-installed is left')
    for (const x of [r.why]) assert.doesNotMatch(x, /Error|ENO|stack|undefined/)
    // found on Linux by its own name in the archive
    r = await installGodot({ ...base, fetchImpl: answer() })
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
      runner: async (cmd, args, opts) => { calls.push([cmd, args, opts?.env]); return RAN(cmd, args) } })
    assert.deepEqual([r.ok, r.route, r.bin, r.version], [true, 'brew', APP, '4.7.2'])
    assert.deepEqual(calls[0].slice(0, 2), ['/opt/homebrew/bin/brew', ['install', '--cask', 'godot']])
    // no terminal and an askpass that always fails: a password is never asked for
    assert.equal(calls[0][2].SUDO_ASKPASS, '/usr/bin/false')
    assert.ok(!calls.some(c => c[0] === 'sudo' || c[1].includes('sudo')))

    // brew missing: the archive, and brew is never run
    calls = []
    r = await installGodot({ ...base, exists: () => false, fetchImpl: answer(), runner: async (cmd, args) => { calls.push(cmd); return RAN(cmd, args) } })
    assert.deepEqual([r.ok, r.route, r.note], [true, 'archive', undefined])
    assert.ok(!calls.some(c => /brew/.test(c)))

    // brew wants a password: refused, said, and the archive instead (into the data folder, no password)
    r = await installGodot({ ...base, exists: f => f === '/usr/local/bin/brew', find: () => null, fetchImpl: answer(),
      runner: async (cmd, args) => (/brew$/.test(cmd) ? { ok: false, out: 'sudo: no password was provided\nsudo: a password is required' } : RAN(cmd, args)) })
    assert.deepEqual([r.ok, r.route, r.note], [true, 'archive', 'Homebrew asked for a password, so Godot came from its own releases.'])
    assert.ok(r.bin.startsWith(dir + sep))
    // brew failed another way and the archive fails too: the archive's reason, no note
    r = await installGodot({ ...base, exists: f => f === '/usr/local/bin/brew', find: () => null, fetchImpl: async () => { throw new Error('offline') }, runner: async () => ({ ok: false, out: 'Error: Download failed' }) })
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
