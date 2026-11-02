import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('客户端模块注册设置分区', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const React = {
    createElement: () => null,
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useId: () => 'id',
  }
  const sandbox = {
    window: { __ModuleLoader__: { load(definition) { this.definition = definition } } },
    fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  const definition = sandbox.window.__ModuleLoader__.definition
  assert.equal(definition.id, 'dsh-memory-rag')
  assert.equal(typeof definition.factory, 'function')

  const clientModule = definition.factory((name) => {
    assert.equal(name, 'react')
    return React
  })
  assert.deepEqual(Array.from(clientModule.inject), ['slots'])

  const registrations = []
  const injects = []
  const ctx = {
    slots: {
      inject(name, callback) {
        injects.push(name)
        callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  clientModule.apply(ctx)

  assert.deepEqual(injects, ['settings.section', 'sidebar.panellist', 'main'])

  const settings = registrations.find((item) => item.options.name === 'settings.section')
  assert.equal(settings.options.id, 'rag-memory')
  assert.equal(typeof settings.options.label(), 'string')
  assert.equal(typeof settings.component, 'function')

  const panel = registrations.find((item) => item.options.name === 'sidebar.panellist')
  assert.equal(panel.options.id, 'rag-memory-insights')
  assert.equal(typeof panel.options.label(), 'string')
  assert.equal(typeof panel.component, 'function')

  const main = registrations.find((item) => item.options.name === 'main')
  assert.equal(main.options.key, 'rag-memory-insights')
  assert.equal(typeof main.component, 'function')
})

test('客户端模块在无 fetch 时不抛错（仅加载阶段）', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const sandbox = {
    window: { __ModuleLoader__: { load(definition) { this.definition = definition } } },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.equal(typeof sandbox.window.__ModuleLoader__.definition.factory, 'function')
})
