// Godot 4, installed when the person asks for it in the game chat ("Install Godot 4", or "install godot" typed):
// never at start, never by itself (server/talk.mjs do:godot; docs/engines/godot.md, Not installed).
//
// The route, in order:
//   macOS with Homebrew   `brew install --cask godot` (the app lands in /Applications, where engine/port.mjs
//                         godotBin already looks). Run with no terminal and an askpass that always fails, so a
//                         password it wants is a refusal, never a prompt; then the archive below.
//   every platform        the official editor archive of one pinned release from the Godot project's GitHub
//                         releases, checked against the SHA-512 the release publishes (SHA512-SUMS.txt, recorded
//                         in GODOT.files) before it is unpacked, into <data folder>/godot/<version>/. Nothing is
//                         written outside the Studio's data folder, and nothing needs a password.
// "Installed" means the program ran: `--version` answered 4.x from where it was put.
//
//   GODOT                        the pinned release and its files
//   ownGodot(dataDir)            the Studio's own copy, or null (engine/port.mjs godotBin looks here last)
//   installGodot(opts)           -> { ok: true, route, bin, version, note? } | { ok: false, route, why }
//   godotJob({ install })        one install at a time, for every chat: start(), state(), busy()
//
// `why` is a plain reason that finishes the sentence "Nothing happened: …"; a raw error goes to the log only.
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { delimiter, join, posix, resolve, sep } from 'node:path'
import { execFile } from './proc.mjs'

// One stable release, exact files. The sums are the release's own SHA512-SUMS.txt
// (https://github.com/godotengine/godot/releases/download/4.7.2-stable/SHA512-SUMS.txt, read 2026-11-15).
export const GODOT = {
  version: '4.7.2',
  base: 'https://github.com/godotengine/godot/releases/download/4.7.2-stable/',
  files: {
    darwin: { name: 'Godot_v4.7.2-stable_macos.universal.zip', size: 170622178, bin: 'Godot.app/Contents/MacOS/Godot', sha512: '38aa16e5bba2083941fc5b3e54be0089bd4cc35e32415f5b9fd9a8a6a7b9818255d44532ea8ef94b5aef56c4b407c2d634fa4f657e4ebe681ebbf59b7bac69ca' },
    'linux-x64': { name: 'Godot_v4.7.2-stable_linux.x86_64.zip', size: 77860424, bin: 'Godot_v4.7.2-stable_linux.x86_64', sha512: '9aa00f7a605200940bce3027a567b782f49bd8e940dd06ae9e987bd65aee1b1467edd56ed84fcdcbdd44354bf613bdbb4e5d2913e925850368e150c59ed54c65' },
    'linux-arm64': { name: 'Godot_v4.7.2-stable_linux.arm64.zip', size: 77008699, bin: 'Godot_v4.7.2-stable_linux.arm64', sha512: 'dd59918da086bd49bde2f5450b5e567ff8650cbde9abbd7b8f4ca1197ff8c609baa38834666d032deafb47099078d7822279e2a0e06e5665745468f26533e7e2' },
    'win32-x64': { name: 'Godot_v4.7.2-stable_win64.exe.zip', size: 86013866, bin: 'Godot_v4.7.2-stable_win64_console.exe', sha512: '83decd58fdf67b9d657958a1ae6bf1929c20785315a81effe245874cdc57acb709bf868e00778a96984338c1b29dafdb453c6847747694621c6ecf5da2259993' },
    'win32-arm64': { name: 'Godot_v4.7.2-stable_windows_arm64.exe.zip', size: 84263370, bin: 'Godot_v4.7.2-stable_windows_arm64_console.exe', sha512: '683f8dd9fb087db79dfbbc52d5b2209df98218a4fef0d10d8478ec2230ae8db6032a36929677479b9f9c5a6aa0c51ee359d7e57eb5abbcb6cef4998526dec5a6' }
  }
}
// The Web export templates of the same release, in one file: without them a Web export fails with Godot's own
// "No export template found at the expected path". It is the release's own .tpz, and the sum is its
// SHA512-SUMS.txt line (same file, read 2026-11-15). Godot looks for them under its version, so they are put
// where it looks, not in the Studio's folder: this is the one thing Swarm writes outside the data folder.
export const TEMPLATES = {
  name: 'Godot_v4.7.2-stable_export_templates.tpz',
  size: 1281349702,
  sha512: 'ca4d71c4d7b81dfc15d1a98baa07534aa95b03fdda78a0075b06672e1648d2e5f40980c9adc28d23e1b92e732ee7bf3461997aa804af74ec2fcd7a93ccb84079',
  // the two the Web preset needs (variant/thread_support=false: the nothreads pair)
  web: ['web_nothreads_debug.zip', 'web_nothreads_release.zip'],
  // only what a Web export needs is unpacked: 1.28 GB comes down, 20 MB is kept
  keep: /^templates\/(web_[a-z_]+\.zip|version\.txt)$/
}
export const fileFor = (platform = process.platform, arch = process.arch, release = GODOT) => release.files[platform === 'darwin' ? 'darwin' : `${platform}-${arch}`] || null
const mbOf = f => Math.round(f.size / 1e6)

// Where Godot 4 looks for its templates, by platform (Godot's own `EditorPaths::get_export_templates_dir`).
// version is the editor's, "4.7.2": the folder Godot names is "4.7.2.stable", which is what its version.txt says.
export function templatesRoot({ platform = process.platform, home = process.env.HOME || process.env.USERPROFILE || '', env = process.env } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Godot', 'export_templates')
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Godot', 'export_templates')
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'godot', 'export_templates')
}
// The folder for a release, "4.7.2.stable": Godot reads the `version.txt` inside it, so the name is that file's
export const templatesFolder = (version, root = templatesRoot()) => join(root, `${version}.stable`)
// The two Web templates are there and non-empty: what `exportWeb` needs, nothing else (a folder Godot fills itself
// with every platform counts as missing here only when these two are)
export const ownTemplates = (version, { root = templatesRoot(), exists = existsSync, sizeOf = f => { try { return statSync(f).size } catch { return 0 } }, files = TEMPLATES } = {}) =>
  files.web.every(name => exists(join(templatesFolder(version, root), name)) && sizeOf(join(templatesFolder(version, root), name)) > 0)

export const godotHome = dataDir => join(dataDir, 'godot')
// The Studio's own copy: what current.json names, only inside the Studio's godot folder, only if it is there.
export function ownGodot(dataDir, exists = existsSync) {
  try {
    const home = resolve(godotHome(dataDir))
    const bin = resolve(home, String(JSON.parse(readFileSync(join(home, 'current.json'), 'utf8')).bin || ''))
    return bin.startsWith(home + sep) && exists(bin) ? bin : null
  } catch { return null }
}

// Homebrew, also where an app opened from the Dock does not have it on PATH (issue #405)
export function brewOf(env = process.env, exists = existsSync) {
  const dirs = [...String(env.PATH || '').split(delimiter).filter(Boolean), '/opt/homebrew/bin', '/usr/local/bin']
  return dirs.map(d => posix.join(d, 'brew')).find(f => exists(f)) || null
}

// run(cmd, args, opts) -> { ok, out }: never throws, never has a terminal (its input is closed at once)
export const run = (cmd, args, opts = {}) => new Promise(done => {
  try {
    const child = execFile(cmd, args, { timeout: 60000, maxBuffer: 1 << 22, windowsHide: true, ...opts }, (err, out, errOut) => done({ ok: !err, out: `${out || ''}\n${errOut || ''}` }))
    child.stdin?.end()
    child.on('error', () => {})
  } catch (err) { done({ ok: false, out: String(err?.message || err) }) }
})

// "4.7.2" from `--version` ("4.7.2.stable.official.abc123"), or null when it did not run or is not Godot 4
export async function versionOf(bin, runner = run) {
  const r = await runner(bin, ['--version'], { timeout: 60000 })
  return String(r.out || '').match(/^\s*(4\.\d+(?:\.\d+)?)\b/m)?.[1] || null
}

// The archive unpacked with the system's own tool: ditto on macOS (it keeps the app's links and its program's
// run bit), tar on Windows (bsdtar, which reads zip), unzip elsewhere (as engine/assetlib.mjs does).
export async function unpackZip(zip, to, { platform = process.platform, runner = run } = {}) {
  const [cmd, args] = platform === 'darwin' ? ['/usr/bin/ditto', ['-x', '-k', zip, to]] : platform === 'win32' ? ['tar', ['-xf', zip, '-C', to]] : ['unzip', ['-qq', '-o', zip, '-d', to]]
  return (await runner(cmd, args, { timeout: 300000 })).ok
}

// the program inside the unpacked folder: the recorded name, else the one file that is Godot's
function binIn(dir, f, platform) {
  if (existsSync(join(dir, f.bin))) return f.bin
  if (platform === 'darwin') return null
  const names = readdirSync(dir).filter(n => /^Godot_v/i.test(n))
  return (platform === 'win32' ? names.find(n => /_console\.exe$/i.test(n)) || names.find(n => /\.exe$/i.test(n)) : names.find(n => !/\.(txt|md)$/i.test(n))) || null
}

const PASSWORD = /\bsudo\b|password|askpass/i
const HOUR = 3600000

async function fromArchive({ dataDir, platform, arch, release, fetchImpl, unpack, runner, onProgress, log }) {
  const f = fileFor(platform, arch, release)
  const fail = why => ({ ok: false, route: f ? 'archive' : 'none', why })
  if (!f) return fail('Godot has no download for this kind of computer: get it from godotengine.org, then press Check again')
  const home = godotHome(dataDir), work = join(home, `.part-${randomBytes(4).toString('hex')}`), zip = join(work, f.name), to = join(home, release.version)
  try {
    mkdirSync(work, { recursive: true })
    onProgress({ route: 'archive', mb: mbOf(f), pct: 0 })
    let res
    try { res = await fetchImpl(release.base + f.name, { redirect: 'follow', signal: AbortSignal.timeout(HOUR) }) } catch (err) { log(`godot install: ${err?.cause?.code || err?.message || err}`); return fail('this computer could not reach github.com') }
    if (!res.ok || !res.body) return fail(`github.com answered ${res.status} for the download`)
    const hash = createHash('sha512'), out = createWriteStream(zip)
    let got = 0, pct = 0
    try {
      for await (const chunk of res.body) {
        got += chunk.length
        if (got > f.size) break
        hash.update(chunk)
        if (!out.write(chunk)) await once(out, 'drain')
        const p = Math.floor(got / f.size * 100)
        if (p !== pct) onProgress({ pct: pct = p })
      }
      await new Promise((ok, no) => out.end(err => (err ? no(err) : ok())))
    } catch (err) {
      out.destroy()
      log(`godot install: ${err?.code || err?.name || err}`)
      return fail(err?.code === 'ENOSPC' ? 'the disk is full' : err?.name === 'TimeoutError' ? 'the download took over an hour' : 'the download stopped before it finished')
    }
    // the whole file, and exactly the one the release published: checked before anything of it is opened
    if (got !== f.size || hash.digest('hex') !== f.sha512) return fail('the download did not match the checksum Godot published, so it was thrown away')
    const fresh = join(work, 'out')
    mkdirSync(fresh)
    if (!(await unpack(zip, fresh, { platform, runner }))) return fail('the download could not be unpacked on this computer')
    const rel = binIn(fresh, f, platform)
    if (!rel) return fail('the download held no Godot program')
    if (platform !== 'win32') chmodSync(join(fresh, rel), 0o755)
    rmSync(to, { recursive: true, force: true })
    renameSync(fresh, to)
    const bin = join(to, rel)
    const version = await versionOf(bin, runner)
    if (!version) { rmSync(to, { recursive: true, force: true }); return fail('the downloaded Godot did not start on this computer') }
    writeFileSync(join(home, 'current.json'), JSON.stringify({ version, bin: join(release.version, rel), from: release.base + f.name, sha512: f.sha512 }, null, 1))
    return { ok: true, route: 'archive', bin, version }
  } catch (err) {
    log(`godot install: ${err?.code || err?.message || err}`)
    return fail(err?.code === 'ENOSPC' ? 'the disk is full' : 'Godot could not be put in the Studio\'s folder')
  } finally { rmSync(work, { recursive: true, force: true }) }
}

// The Web export templates, once per release: downloaded to the Studio's own folder, checked against the sum the
// release publishes, then only the Web ones unpacked where Godot looks for them. A folder already holding them is
// left alone (a person who installed templates by hand keeps theirs).
//   -> { ok: true, route: 'archive', dir, mb } | { ok: false, route, why }
export async function installTemplates({ dataDir, platform = process.platform, version = GODOT.version, release = GODOT, root = templatesRoot({ platform }), exists = existsSync, fetchImpl = fetch, runner = run, unpack = unpackZip, TEMPLATES: files = TEMPLATES, onProgress = () => {}, log = () => {} }) {
  const fail = why => ({ ok: false, route: 'archive', why })
  if (ownTemplates(version, { root, exists, files })) return { ok: true, route: 'archive', dir: templatesFolder(version, root), mb: 0, note: 'they were already there' }
  const home = godotHome(dataDir), work = join(home, `.tpl-${randomBytes(4).toString('hex')}`), tpz = join(work, files.name)
  try {
    mkdirSync(work, { recursive: true })
    onProgress({ route: 'templates', mb: mbOf(files), pct: 0 })
    let res
    try { res = await fetchImpl(release.base + files.name, { redirect: 'follow', signal: AbortSignal.timeout(HOUR) }) } catch (err) { log(`godot templates: ${err?.cause?.code || err?.message || err}`); return fail('this computer could not reach github.com') }
    if (!res.ok || !res.body) return fail(`github.com answered ${res.status} for the templates`)
    const hash = createHash('sha512'), out = createWriteStream(tpz)
    let got = 0, pct = 0
    try {
      for await (const chunk of res.body) {
        got += chunk.length
        if (got > files.size) break
        hash.update(chunk)
        if (!out.write(chunk)) await once(out, 'drain')
        const p = Math.floor(got / files.size * 100)
        if (p !== pct) onProgress({ pct: pct = p })
      }
      await new Promise((ok, no) => out.end(err => (err ? no(err) : ok())))
    } catch (err) {
      out.destroy()
      log(`godot templates: ${err?.code || err?.name || err}`)
      return fail(err?.code === 'ENOSPC' ? 'the disk is full' : err?.name === 'TimeoutError' ? 'the download took over an hour' : 'the download stopped before it finished')
    }
    if (got !== files.size || hash.digest('hex') !== files.sha512) return fail('the templates did not match the checksum Godot published, so they were thrown away')
    // only the Web ones, straight into the folder Godot reads: the archive is a zip of `templates/…`
    const to = templatesFolder(version, root)
    const unpacked = join(work, 'out')
    mkdirSync(unpacked, { recursive: true })
    if (!(await unpack(tpz, unpacked, { platform, runner }))) return fail('the templates could not be unpacked on this computer')
    const from = join(unpacked, 'templates')
    if (!exists(from)) return fail('the download held no templates')
    mkdirSync(to, { recursive: true })
    let kept = 0
    for (const name of readdirSync(from)) {
      if (!files.keep.test(`templates/${name}`)) continue
      renameSync(join(from, name), join(to, name))
      kept++
    }
    if (!ownTemplates(version, { root, exists, files })) return fail('the templates did not land where Godot looks for them')
    return { ok: true, route: 'archive', dir: to, mb: mbOf(files), files: kept }
  } catch (err) {
    log(`godot templates: ${err?.code || err?.message || err}`)
    return fail(err?.code === 'ENOSPC' ? 'the disk is full' : 'the templates could not be put where Godot looks for them')
  } finally { rmSync(work, { recursive: true, force: true }) }
}

// find() -> the Godot the Studio would use now (engine/port.mjs godotBin), or null. release is GODOT; a test hands
// in its own small one, so the checksum is checked on every path.
export async function installGodot({ dataDir, find = () => null, platform = process.platform, arch = process.arch, env = process.env, exists = existsSync, release = GODOT, runner = run, fetchImpl = fetch, unpack = unpackZip, templates = installTemplates, onProgress = () => {}, log = () => {} }) {
  let note = ''
  const brew = platform === 'darwin' ? brewOf(env, exists) : null
  if (brew) {
    onProgress({ route: 'brew' })
    const r = await runner(brew, ['install', '--cask', 'godot'], { timeout: 900000, env: { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1', SUDO_ASKPASS: '/usr/bin/false' } })
    const bin = r.ok ? find() : null
    const version = bin ? await versionOf(bin, runner) : null
    if (version) return withTemplates({ ok: true, route: 'brew', bin, version }, { dataDir, platform, version, release, runner, fetchImpl, onProgress, log, templates })
    if (PASSWORD.test(r.out)) note = 'Homebrew asked for a password, so Godot came from its own releases.'
    log(`godot install: brew did not install it${note ? ' (it asked for a password)' : ''}`)
  }
  const r = await fromArchive({ dataDir, platform, arch, release, fetchImpl, unpack, runner, onProgress, log })
  if (!r.ok) return r
  return withTemplates(note ? { ...r, note } : r, { dataDir, platform, version: r.version, release, runner, fetchImpl, onProgress, log, templates })
}

// The editor is installed; the templates are the other half of a Web export, and they are a second, larger
// download. They never fail the editor's install: the editor works without them, and `templates` says what
// happened so the chat can offer the one action that is left ("Install the export templates").
async function withTemplates(installed, { dataDir, platform, version, release, runner, fetchImpl, onProgress, log, templates }) {
  let t
  try { t = await templates({ dataDir, platform, version, release, runner, fetchImpl, onProgress, log }) } catch (err) { log(`godot templates: ${err?.message || err}`); t = { ok: false, why: 'the export templates could not be installed' } }
  return { ...installed, templates: t.ok ? { ok: true, mb: t.mb ?? 0 } : { ok: false, why: t.why || 'the export templates could not be installed' } }
}

// One install at a time for the whole Studio: a second press, or another chat, joins the one in flight.
// state() -> { state: 'idle' | 'installing' | 'done' | 'failed', route?, mb?, pct?, version?, why? }
export function godotJob({ install }) {
  let now = { state: 'idle' }, flight = null
  return {
    state: () => now,
    busy: () => !!flight,
    start() {
      if (flight) return flight
      now = { state: 'installing' }
      flight = Promise.resolve().then(() => install({ onProgress: p => { if (flight) now = { ...now, ...p } } }))
        .catch(() => ({ ok: false, route: 'none', why: 'Godot could not be installed here' }))
        .then(r => { flight = null; now = r.ok ? { state: 'done', version: r.version } : { state: 'failed', why: r.why }; return r })
      return flight
    }
  }
}
