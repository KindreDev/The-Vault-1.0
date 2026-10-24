const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ensureFrontend } = require('../ensure-frontend.cjs')

function fixture(t) {
  const frontend = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dependencies-'))
  t.after(() => fs.rmSync(frontend, { recursive: true, force: true }))
  fs.writeFileSync(path.join(frontend, 'package.json'), JSON.stringify({
    dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' },
  }))
  const lock = { lockfileVersion: 3, packages: {
    '': {}, 'node_modules/react': { version: '18.3.1', integrity: 'react-fixture' },
    'node_modules/vite': { version: '5.4.21', integrity: 'vite-fixture', dev: true },
    'node_modules/transitive': { version: '1.0.0', integrity: 'transitive-fixture' },
    'node_modules/other-platform': { version: '1.0.0', optional: true },
  } }
  const lockFile = path.join(frontend, 'package-lock.json')
  fs.writeFileSync(lockFile, JSON.stringify(lock))
  const installer = path.join(frontend, 'installer.cjs')
  fs.writeFileSync(installer, `
    const fs = require('node:fs'), path = require('node:path');
    fs.appendFileSync('installs', JSON.stringify(process.argv.slice(2)) + '\\n');
    if (process.env.FIXTURE_INSTALL_FAIL) process.exit(9);
    const lock = JSON.parse(fs.readFileSync('package-lock.json'));
    for (const [location, entry] of Object.entries(lock.packages)) {
      if (!location || entry.optional) continue;
      fs.mkdirSync(location, { recursive: true });
      fs.writeFileSync(path.join(location, 'package.json'), JSON.stringify({version: entry.version}));
    }
    fs.mkdirSync('node_modules/vite/bin', {recursive:true});
    fs.writeFileSync('node_modules/vite/bin/vite.js', "console.log('vite fixture')");
    fs.mkdirSync('node_modules/.bin', {recursive:true});
    for (const bin of ['vite', 'vite.cmd']) {
      fs.writeFileSync(path.join('node_modules/.bin', bin), '#!/bin/sh\\n');
      fs.chmodSync(path.join('node_modules/.bin', bin), 0o755);
    }
    fs.writeFileSync('node_modules/.package-lock.json', JSON.stringify(lock));
  `)
  const options = { frontend, env: { ...process.env, npm_execpath: installer }, log: () => {} }
  const run = overrides => ensureFrontend({ ...options, ...overrides })
  const installs = () => fs.readFileSync(path.join(frontend, 'installs'), 'utf8').trim().split('\n').map(JSON.parse)
  return { frontend, run, installs, lock, lockFile, options }
}

test('missing installation includes development and optional packages, then normal startup skips it', t => {
  const f = fixture(t)
  f.run()
  assert.deepEqual(f.installs()[0], ['ci', '--include=dev', '--include=optional', '--bin-links=true', '--no-audit', '--no-fund'])
  f.run()
  assert.equal(f.installs().length, 1)
})

test('existing complete installation is adopted without reinstalling', t => {
  const f = fixture(t)
  f.run()
  fs.unlinkSync(path.join(f.frontend, 'node_modules/.vault-dependencies'))
  f.run()
  assert.equal(f.installs().length, 1)
})

test('a changed lock file refreshes installed versions', t => {
  const f = fixture(t)
  f.run()
  f.lock.packages['node_modules/transitive'].version = '2.0.0'
  fs.writeFileSync(f.lockFile, JSON.stringify(f.lock))
  f.run()
  assert.equal(f.installs().length, 2)
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.frontend, 'node_modules/transitive/package.json'))).version, '2.0.0')
})

test('missing Vite command or transitive package is repaired', t => {
  const f = fixture(t)
  f.run()
  fs.unlinkSync(path.join(f.frontend, 'node_modules/.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'))
  f.run()
  fs.unlinkSync(path.join(f.frontend, 'node_modules/transitive/package.json'))
  f.run()
  assert.equal(f.installs().length, 3)
})

test('installer failure stops startup and does not write a success stamp', t => {
  const f = fixture(t)
  assert.throws(() => f.run({ env: { ...f.options.env, FIXTURE_INSTALL_FAIL: '1' } }), /installation failed/)
  assert.equal(fs.existsSync(path.join(f.frontend, 'node_modules/.vault-dependencies')), false)
})

test('broken Vite executable is repaired before startup', t => {
  const f = fixture(t)
  f.run()
  fs.writeFileSync(path.join(f.frontend, 'node_modules/vite/bin/vite.js'), 'process.exit(1)')
  f.run()
  assert.equal(f.installs().length, 2)
})
