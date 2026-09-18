import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')

// Execute the actual TS modules with browser/device boundaries mocked. This is not
// a real browser, acoustic test, full type check, or a claim of a live MMIR answer.
function load(path, { imports = {}, env = {}, globals = {} } = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/(?<!['"])import\.meta\.env/g, 'TEST_ENV')
  const compiled = ts.transpileModule(source, { fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } })
  const errors = compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? []
  assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))
  const exports = {}
  const context = vm.createContext({ exports, TEST_ENV: env, console, TextDecoder, AbortController,
    AbortSignal, DOMException, Response, setTimeout, clearTimeout, setInterval, clearInterval,
    require: name => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name] }, ...globals })
  new vm.Script(compiled.outputText, { filename: path }).runInContext(context)
  return { exports, context }
}
function browserClient(fetch) {
  const events = []
  const { exports } = load('src/lib/mmir.ts', { imports: { '../config': { BRIDGE_HTTP_URL: 'http://127.0.0.1:8787' } },
    globals: { fetch, window: { dispatchEvent: e => events.push(e) },
      CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value.detail } } } })
  return { client: exports, events }
}
const health = () => Response.json({ ok: true, backend: 'mmir' })
const answer = (text, model = 'gateway-reported-model') => new Response([
  { type: 'text', delta: text },
  { type: 'done', model, text, mmir: { route_receipt: { receipt_id: 'fixture', status: 'succeeded' } } },
].map(v => JSON.stringify(v)).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } })
const callbacks = () => ({ onText() {}, onTool() {} })

test('UI client streams a real transport result, preserves evidence and replays bounded conversation', async () => {
  const bodies = [], deltas = []
  const { client, events } = browserClient(async (url, options) => {
    if (url.endsWith('/health')) return health()
    bodies.push(JSON.parse(options.body)); return answer('Ærlig svar fra MMIR.')
  })
  await client.ask('Første spørsmål?', { onText: t => deltas.push(t), onTool() {} })
  assert.equal(deltas.join(''), 'Ærlig svar fra MMIR.')
  assert.equal(events[0].type, 'mmir:receipt')
  assert.equal(client.evidence().receiptVerified, false)
  await client.ask('Og det neste?', callbacks())
  assert.equal(bodies[1].messages.length, 3)
  assert.equal(bodies[1].messages[1].role, 'assistant')
  assert.equal(bodies[1].messages.at(-1).content, 'Og det neste?')
  assert.equal(client.evidence().model, 'gateway-reported-model')
  assert.equal(client.isConnected(), true)
})

test('UI refuses a Claude bridge and never switches providers', async () => {
  let calls = 0
  const { client } = browserClient(async () => { calls++; return Response.json({ ok: true, backend: 'claude' }) })
  await assert.rejects(client.ask('Hei', callbacks()), /Feil bridge/)
  assert.equal(calls, 1)
  assert.equal(client.isConnected(), false)
})

test('UI handles gateway error and incomplete NDJSON without success evidence', async () => {
  for (const body of [{ type: 'error', message: 'Ingen svarmodell.' }, { type: 'text', delta: 'Ufullført' }]) {
    const { client } = browserClient(async url => url.endsWith('/health') ? health() : new Response(JSON.stringify(body) + '\n', {
      headers: { 'content-type': 'application/x-ndjson' },
    }))
    await assert.rejects(client.ask('Hei', callbacks()))
    assert.equal(client.evidence(), null)
  }
})

test('UI barge-in aborts transport and does not commit an abandoned turn', async () => {
  let waiting, gotSignal
  const started = new Promise(resolve => { waiting = resolve })
  const bodies = []
  const { client } = browserClient(async (url, options) => {
    if (url.endsWith('/health')) return health()
    bodies.push(JSON.parse(options.body))
    if (bodies.length > 1) return answer('Nytt svar')
    gotSignal = options.signal; waiting()
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  })
  const pending = client.ask('Første', callbacks())
  await started; client.cancel()
  assert.equal(gotSignal.aborted, true)
  assert.equal((await pending).text, '')
  await client.ask('Neste', callbacks())
  assert.equal(bodies[1].messages.length, 1)
})

function voiceHarness({ denied = false, recognizer = true } = {}) {
  let mode = 'wake', speechStarts = 0
  const wakes = [], utterances = [], errors = [], instances = [], timers = new Map()
  let id = 0, now = 10000
  class Recognition {
    constructor() { instances.push(this) }
    start() { this.onstart?.() }
    abort() { this.onend?.() }
    result(text) {
      const part = [{ transcript: text }]; part.isFinal = true
      this.onresult({ resultIndex: 0, results: [part] })
    }
  }
  const { exports: voice } = load('src/lib/voice.ts', { env: { VITE_VOICE_LANGUAGE: 'nb-NO' },
    imports: {
      '../config': { BRIDGE_HTTP_URL: 'http://127.0.0.1:8787' },
      './audio': { getMic: async () => { if (denied) throw new DOMException('Denied', 'NotAllowedError') } },
      './tts': { speakingNow: () => '', speakingSince: () => 0 },
      './vad': { startVad: () => { throw new Error('Premium path must not start') } },
      './capabilities': { caps: () => ({ stt: false }) },
    }, globals: {
      window: recognizer ? { SpeechRecognition: Recognition } : {},
      Date: { now: () => now },
      setTimeout: (fn, ms) => { const n = ++id; timers.set(n, { fn, at: now + ms }); return n },
      clearTimeout: n => timers.delete(n), setInterval: () => ++id, clearInterval() {},
      fetch: () => { throw new Error('Unexpected external voice request') },
    } })
  const handlers = { mode: () => mode, onWake: text => { wakes.push(text); mode = 'command' },
    onSpeechStart: () => { speechStarts++; mode = 'command' }, onPartial() {},
    onUtterance: text => utterances.push(text), onError: error => errors.push(error) }
  return { voice, handlers, instances, wakes, utterances, errors,
    speechStarts: () => speechStarts, setMode: v => { mode = v },
    advance: ms => { now += ms; for (const [n, task] of [...timers]) if (task.at <= now) { timers.delete(n); task.fn() } },
  }
}
test('Norwegian browser recognition: wake, utterance, barge-in and stop lifecycle', async () => {
  const h = voiceHarness(), v = await h.voice.startVoice(h.handlers), rec = h.instances[0]
  assert.equal(rec.lang, 'nb-NO'); assert.equal(v.live(), true)
  rec.result('Hei Jarvis, hva er hovedstaden i Norge?')
  assert.equal(h.wakes[0], 'hva er hovedstaden i Norge?')
  rec.result('Kan du si det på norsk?'); h.advance(900)
  assert.equal(h.utterances[0], 'Kan du si det på norsk?')
  h.setMode('guard'); rec.result('stopp')
  assert.equal(h.speechStarts(), 2)
  v.stop(); h.advance(2000)
  assert.equal(v.live(), false); assert.equal(h.utterances.length, 1)
})
test('Denied microphone and missing browser recognition are honest failures', async () => {
  for (const config of [{ denied: true }, { recognizer: false }]) {
    const h = voiceHarness(config), v = await h.voice.startVoice(h.handlers)
    assert.equal(v.live(), false); assert.equal(h.errors.length, 1); assert.equal(h.instances.length, 0)
  }
})
test('Norwegian TTS preference selects an installed voice without overwriting a chosen one', () => {
  for (const existing of [null, 'Chosen voice']) {
    let saved = existing
    load('src/lib/mmir-locale.ts', { env: { VITE_VOICE_LANGUAGE: 'nb-NO' }, globals: {
      document: { documentElement: {} }, localStorage: { getItem: () => saved, setItem: (_, v) => { saved = v } },
      speechSynthesis: { getVoices: () => [{ name: 'English', lang: 'en-GB' }, { name: 'Norwegian', lang: 'nb-NO', localService: true }], addEventListener() {} },
    } })
    assert.equal(saved, existing ?? 'Norwegian')
  }
})
test('MMIR build ignores legacy environment files and has no automatic public env export', () => {
  const { exports } = load('vite.config.ts', { imports: { vite: { defineConfig: v => v }, '@vitejs/plugin-react': () => ({}) },
    globals: { process: { env: { VITE_GITHUB_TOKEN: 'secret-fixture', MMIR_API_KEY: 'secret-fixture' } } } })
  assert.equal(exports.default.envDir, false)
  assert.equal(exports.default.envPrefix.length, 0)
  assert.equal(JSON.stringify(exports.default.define).includes('secret-fixture'), false)
  assert.equal(exports.default.define['import.meta.env.VITE_MMIR_MODE'], '"1"')
})
