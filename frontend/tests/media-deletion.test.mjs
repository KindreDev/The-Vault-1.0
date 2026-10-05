import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function fixture() {
  const events = []
  const client = {
    interceptors: { response: { use() {} } },
    delete: (...args) => { events.push(['delete', ...args]); return Promise.resolve({ data: {} }) },
    post: (...args) => { events.push(['post', ...args]); return Promise.resolve({ data: {} }) },
  }
  const context = vm.createContext({
    document: { querySelectorAll: () => [{
      pause: () => events.push(['pause']),
      removeAttribute: name => events.push(['removeAttribute', name]),
      load: () => events.push(['load']),
    }] },
  })
  const source = await readFile(new URL('../src/lib/api.js', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(source, { context })
  await module.link(specifier => {
    const exports = specifier === 'axios' ? { default: { create: () => client } }
      : specifier.includes('packPurchase') ? { openRecoverablePack() {} }
        : specifier.includes('queryClient') ? { default: {} }
          : specifier.includes('xpEvents') ? { xpEvents: {} }
            : specifier.includes('store/vault') ? { useVaultStore: {} }
              : { refreshAfterMutation() {} }
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
  })
  await module.evaluate()
  return { api: module.namespace, events }
}

test('individual and bulk media deletion release playback and reach the API', async () => {
  for (const bulk of [false, true]) {
    const { api, events } = await fixture()
    await (bulk ? api.imagesApi.bulkDelete([42, 43]) : api.imagesApi.delete(42))
    assert.deepEqual(events.slice(0, 3), [['pause'], ['removeAttribute', 'src'], ['load']])
    assert.equal(events[3][0], bulk ? 'post' : 'delete')
    assert.equal(events[3][1], bulk ? '/images/bulk-delete' : '/images/42')
    assert.equal(events[3].at(-1).params.keep_file, false)
  }
})

test('keeping original files skips playback release and preserves keep_file', async () => {
  for (const bulk of [false, true]) {
    const { api, events } = await fixture()
    await (bulk ? api.imagesApi.bulkDelete([42], true) : api.imagesApi.delete(42, true))
    assert.equal(events.length, 1)
    assert.equal(events[0].at(-1).params.keep_file, true)
  }
})

test('gallery disk deletion uses the same working playback release', async () => {
  const { api, events } = await fixture()
  await api.galleriesApi.delete(8, true)
  assert.deepEqual(events.slice(0, 3), [['pause'], ['removeAttribute', 'src'], ['load']])
  assert.equal(events[3][1], '/galleries/8')
  assert.equal(events[3][2].params.delete_files, true)
})
