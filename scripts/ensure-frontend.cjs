// Runs before the development server; uses only Node's built-in modules.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

function ensureFrontend({ frontend = path.resolve(__dirname, '../frontend'), env = process.env,
  platform = process.platform, log = console.log } = {}) {
  const manifestText = fs.readFileSync(path.join(frontend, 'package.json'), 'utf8')
  const lockText = fs.readFileSync(path.join(frontend, 'package-lock.json'), 'utf8')
  const manifest = JSON.parse(manifestText)
  const lock = JSON.parse(lockText)
  const modules = path.join(frontend, 'node_modules')
  const stamp = path.join(modules, '.vault-dependencies')
  const fingerprint = createHash('sha256').update(JSON.stringify({
    dependencies: manifest.dependencies, devDependencies: manifest.devDependencies,
    optionalDependencies: manifest.optionalDependencies, lockText,
    platform, arch: process.arch, nodeMajor: process.versions.node.split('.')[0],
  })).digest('hex')
  const readJSON = file => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
  }
  const readStamp = () => {
    try { return fs.readFileSync(stamp, 'utf8') } catch { return null }
  }
  function ready() {
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const installed = readJSON(path.join(modules, name, 'package.json'))
      if (!installed || installed.version !== lock.packages?.[`node_modules/${name}`]?.version) return false
    }
    try {
      fs.accessSync(path.join(modules, '.bin', platform === 'win32' ? 'vite.cmd' : 'vite'),
        platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
    } catch { return false }
    return spawnSync(process.execPath, [path.join(modules, 'vite/bin/vite.js'), '--version'],
      { cwd: frontend, env, stdio: 'ignore' }).status === 0
  }
  // Adopt an existing npm installation without downloading everything again.
  // npm's installed lock records transitive versions as well as direct packages.
  function installedLockMatches() {
    const installed = readJSON(path.join(modules, '.package-lock.json'))
    if (!installed?.packages || !lock.packages) return false
    return Object.entries(lock.packages).every(([location, expected]) => {
      if (!location || expected.optional) return true
      const actual = installed.packages[location]
      return actual?.version === expected.version && actual?.integrity === expected.integrity
        && fs.existsSync(path.join(frontend, location, 'package.json'))
    })
  }
  const previous = readStamp()
  if (ready() && installedLockMatches() && (previous === fingerprint || !previous)) {
    if (!previous) fs.writeFileSync(stamp, fingerprint)
    return
  }
  log('Preparing frontend packages (including Vite). This may take a moment…')
  if (!env.npm_execpath) throw new Error('Run npm run dev from the frontend directory.')
  const result = spawnSync(process.execPath, [env.npm_execpath, 'ci', '--include=dev',
    '--include=optional', '--bin-links=true', '--no-audit', '--no-fund'],
  { cwd: frontend, env, stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    throw new Error(`Frontend package installation failed. Check the npm error above.${result.error ? ` ${result.error.message}` : ''}`)
  }
  if (!ready() || !installedLockMatches()) {
    throw new Error('Frontend packages are still incomplete after installation; the development server was not started.')
  }
  fs.writeFileSync(stamp, fingerprint)
}

module.exports = { ensureFrontend }
if (require.main === module) {
  try { ensureFrontend() } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
