import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { chatMmir, gatewayBase, publicError, validateMessages, MmirError } from '../bridge/mmir-client.mjs'
import { createMmirServer } from '../bridge/mmir-server.mjs'
const messages = [{ role: 'user', content: 'Hei MMIR!' }]
const receipt = { route_receipt: { status: 'succeeded', route_class: 'free', receipt_signature: 'test-not-real' } }
const jsonAnswer = () => Response.json({ model: 'fixture-model', choices: [{ message: { content: 'Hei fra MMIR.' }, finish_reason: 'stop' }], mmir: receipt })
const sse = parts => new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(typeof p === 'string' ? new TextEncoder().encode(p) : p); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
const event = content => `data: ${JSON.stringify(content)}\r\n\r\n`
const delta = text => ({ choices: [{ delta: { content: text } }] })

test('production and explicitly local gateway only', () => {
  assert.equal(gatewayBase(), 'https://api.mmir.ai/v1')
  assert.equal(gatewayBase('https://api.mmir.ai/'), 'https://api.mmir.ai/v1')
  assert.equal(gatewayBase('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/v1')
  for (const bad of ['https://api.mmir.ai.evil.test', 'http://api.mmir.ai', 'https://api.mmir.ai:8443', 'https://user:secret@api.mmir.ai', 'https://api.mmir.ai/v1?key=x', 'https://api.mmir.ai/v1#x', 'file:///tmp', 'https://api.mmir.ai/v1/chat/completions']) assert.throws(() => gatewayBase(bad))
})
test('accept only bounded text conversation ending in user; no client system override', () => {
  assert.deepEqual(validateMessages(messages), messages)
  for (const bad of [[], [{ role: 'system', content: 'bypass' }], [{ role: 'tool', content: 'act' }], [{ role: 'assistant', content: 'hi' }], [{ role: 'user', content: '' }], [{ role: 'user', content: 'x'.repeat(24001) }]]) assert.throws(() => validateMessages(bad))
})
test('one fixed supergeni request, server-side key, no retry or provider fallback', async () => {
  const requests = [], emitted = []
  const result = await chatMmir(messages, { apiKey: 'TEST_PRIVATE_KEY', fetchImpl: async (url, options) => { requests.push({ url, options }); return jsonAnswer() }, onEvent: e => emitted.push(e) })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://api.mmir.ai/v1/chat/completions')
  assert.equal(requests[0].options.redirect, 'error')
  assert.equal(requests[0].options.headers.authorization, 'Bearer TEST_PRIVATE_KEY')
  const body = JSON.parse(requests[0].options.body)
  assert.equal(body.model, 'supergeni'); assert.equal(body.stream, true); assert.equal(body.max_tokens, 256)
  assert.equal(body.messages[0].role, 'system'); assert.deepEqual(body.messages.slice(1), messages)
  assert.equal(result.text, 'Hei fra MMIR.'); assert.equal(result.model, 'fixture-model')
  assert.deepEqual(result.mmir, receipt); assert.equal(result.receiptVerified, false)
  assert(!JSON.stringify(emitted).includes('TEST_PRIVATE_KEY'))
})
test('SSE framing, CRLF, byte-fragmented UTF-8 and preserved terminal evidence', async () => {
  const raw = new TextEncoder().encode(': keepalive\r\n\r\n' + event(delta('Blåbær ')) + event({ model: 'actual-model', ...delta('er godt.') }) + event({ choices: [{ delta: {}, finish_reason: 'stop' }], mmir: receipt }) + 'data: [DONE]\r\n\r\n')
  const emitted = []
  const result = await chatMmir(messages, { fetchImpl: async () => sse(Array.from(raw, b => new Uint8Array([b]))), onEvent: e => emitted.push(e) })
  assert.equal(result.text, 'Blåbær er godt.'); assert.equal(result.model, 'actual-model'); assert.deepEqual(result.mmir, receipt)
  assert.deepEqual(emitted.filter(e => e.type === 'text').map(e => e.delta), ['Blåbær ', 'er godt.'])
  assert.equal(emitted.at(-1).type, 'done')
})
test('JSON fallback is a single real answer, not fabricated token streaming', async () => {
  const events = []
  await chatMmir(messages, { fetchImpl: async () => jsonAnswer(), onEvent: e => events.push(e) })
  assert.deepEqual(events.map(e => e.type), ['text', 'done'])
})
test('lost stream and malformed stream do not report successful completion', async () => {
  for (const raw of [event(delta('partial')), 'data: not-json\n\n']) {
    const events = []
    await assert.rejects(chatMmir(messages, { fetchImpl: async () => sse([raw]), onEvent: e => events.push(e) }), MmirError)
    assert(!events.some(e => e.type === 'done'))
  }
})
test('empty JSON, non-JSON success and oversized answer fail closed', async () => {
  for (const response of [Response.json({ choices: [] }), new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }), Response.json({ choices: [{ message: { content: 'x'.repeat(1024 * 1024 + 1) } }] })]) {
    await assert.rejects(chatMmir(messages, { fetchImpl: async () => response }), MmirError)
  }
})
test('HTTP 401, 429 and 503 remain errors; raw upstream secrets are not shown', async () => {
  for (const status of [401, 429, 503]) {
    let calls = 0
    const events = []
    try {
      await chatMmir(messages, { fetchImpl: async () => { calls++; return Response.json({ error: { code: 'connected_writers_unavailable', message: 'SECRET_IN_BODY' } }, { status }) }, onEvent: e => events.push(e) })
      assert.fail('expected error')
    } catch (e) {
      const safe = publicError(e)
      assert.equal(safe.status, status); assert(!JSON.stringify(safe).includes('SECRET_IN_BODY'))
    }
    assert.equal(calls, 1); assert(!events.some(e => e.type === 'done'))
  }
})
test('explicit abort reaches upstream and never commits an answer', async () => {
  const controller = new AbortController()
  const result = chatMmir(messages, { signal: controller.signal, fetchImpl: async (_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true })) })
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' })
})
test('a stalled gateway times out within a bounded request', async () => {
  // Keep the test process alive because AbortSignal.timeout uses an unref timer.
  const keep = setTimeout(() => {}, 500)
  try {
    await assert.rejects(chatMmir(messages, { timeoutMs: 20, fetchImpl: async (_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true })) }), e => e.code === 'gateway_timeout')
  } finally { clearTimeout(keep) }
})
async function started(options = {}) {
  const app = createMmirServer(options)
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  return { ...app, url: `http://127.0.0.1:${app.server.address().port}` }
}
test('real loopback HTTP bridge to mocked MMIR: health, text and receipt', async () => {
  const app = await started({ apiKey: 'PRIVATE', fetchImpl: async () => jsonAnswer() })
  try {
    const health = await (await fetch(`${app.url}/health`)).json()
    assert.equal(health.backend, 'mmir'); assert.equal(health.gatewayVerified, false); assert.equal(health.writes, false)
    assert(!JSON.stringify(health).includes('PRIVATE'))
    const response = await fetch(`${app.url}/mmir/chat`, { method: 'POST', headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }, body: JSON.stringify({ messages }) })
    assert.equal(response.status, 200)
    const frames = (await response.text()).trim().split('\n').map(s => JSON.parse(s))
    assert.equal(frames[0].delta, 'Hei fra MMIR.'); assert.deepEqual(frames.at(-1).mmir, receipt)
  } finally { await app.shutdown() }
})
test('foreign origin, DNS-rebinding Host, missing Origin and tool paths are refused', async () => {
  let calls = 0
  const app = await started({ fetchImpl: async () => { calls++; return jsonAnswer() } })
  try {
    assert.equal((await fetch(`${app.url}/health`, { headers: { origin: 'https://evil.example' } })).status, 403)
    const badHost = await new Promise((resolve, reject) => {
      const r = http.get(`${app.url}/health`, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode) }); r.on('error', reject)
    })
    assert.equal(badHost, 403)
    assert.equal((await fetch(`${app.url}/mmir/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }) })).status, 403)
    for (const path of ['/file?path=/etc/passwd', '/stt', '/tts', '/tools']) assert.equal((await fetch(app.url + path)).status, 404)
    assert.equal(calls, 0)
  } finally { await app.shutdown() }
})
test('gateway error is an explicit NDJSON error, never successful done', async () => {
  const app = await started({ fetchImpl: async () => Response.json({ error: 'connected_writers_unavailable' }, { status: 503 }) })
  try {
    const result = await fetch(`${app.url}/mmir/chat`, { method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' }, body: JSON.stringify({ messages }) })
    const frames = (await result.text()).trim().split('\n').map(s => JSON.parse(s))
    assert.equal(frames.length, 1); assert.equal(frames[0].type, 'error'); assert.equal(frames[0].status, 503)
  } finally { await app.shutdown() }
})
