import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chatMmir, gatewayBase, MmirError, publicError } from './mmir-client.mjs'

/** Loopback-only voice transport. No model/provider fallback, filesystem API or MCP. */
export function createMmirServer({ baseUrl = 'https://api.mmir.ai/v1', apiKey = '', uiPort = 5173,
  fetchImpl = fetch, timeoutMs = 45000 } = {}) {
  const base = gatewayBase(baseUrl)
  const origins = new Set([`http://127.0.0.1:${uiPort}`, `http://localhost:${uiPort}`])
  let active = 0
  const inFlight = new Set()
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin
    const address = server.address()
    const hosts = new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`])
    const json = (status, data) => {
      if (res.destroyed) return
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(data))
    }
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('vary', 'Origin')
    if (!hosts.has(req.headers.host) || (origin && !origins.has(origin))) return json(403, { error: 'forbidden' })
    if (origin) res.setHeader('access-control-allow-origin', origin)
    if (req.method === 'OPTIONS') {
      if (!origin) return json(403, { error: 'forbidden' })
      res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS')
      res.setHeader('access-control-allow-headers', 'content-type')
      res.writeHead(204); res.end(); return
    }
    if (req.method === 'GET' && req.url === '/health') return json(200, {
      ok: true, backend: 'mmir', tts: false, stt: false, writes: false,
      modelRequested: 'supergeni', gateway: base, gatewayVerified: false,
      capabilities: { chat: true, localTools: false, cameraToModel: false, persistentMemory: false },
    })
    if (req.method !== 'POST' || req.url !== '/mmir/chat') return json(404, { error: 'not_found' })
    if (!origin || !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return json(403, { error: 'forbidden' })
    }
    // Bounded concurrent requests prevent a local browser from exhausting gateway capacity.
    if (active >= 2) return json(429, { error: 'busy' })
    active++
    const controller = new AbortController()
    inFlight.add(controller)
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      let size = 0
      const chunks = []
      for await (const chunk of req) {
        size += chunk.length
        if (size > 100000) throw new MmirError('invalid_messages', 413)
        chunks.push(chunk)
      }
      let payload
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { throw new MmirError('invalid_messages', 400) }
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' })
      const emit = event => {
        if (!res.destroyed && !controller.signal.aborted) res.write(`${JSON.stringify(event)}\n`)
      }
      await chatMmir(payload.messages, { baseUrl: base, apiKey, fetchImpl, timeoutMs,
        signal: controller.signal, onEvent: emit })
      res.end()
    } catch (error) {
      if (!res.destroyed && !controller.signal.aborted) {
        const safe = publicError(error)
        if (res.headersSent) res.end(`${JSON.stringify({ type: 'error', ...safe })}\n`)
        else json(safe.status, { type: 'error', ...safe })
      }
    } finally { active--; inFlight.delete(controller) }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.keepAliveTimeout = 5000
  server.maxHeadersCount = 32
  const shutdown = () => {
    for (const controller of inFlight) controller.abort()
    server.closeAllConnections()
    return new Promise(resolveClose => server.close(resolveClose))
  }
  return { server, shutdown }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.JARVIS_BRIDGE_PORT || 8787)
  const uiPort = Number(process.env.PORT || 5173)
  if (![port, uiPort].every(n => Number.isInteger(n) && n > 1023 && n < 65536)) {
    console.error('[mmir] Invalid port'); process.exit(1)
  }
  try {
    const { server, shutdown } = createMmirServer({
      baseUrl: process.env.MMIR_BASE_URL || 'https://api.mmir.ai/v1',
      apiKey: process.env.MMIR_API_KEY || '', uiPort,
    })
    server.on('error', () => { console.error('[mmir] Bridge could not listen; check port availability.'); process.exitCode = 1 })
    server.listen(port, '127.0.0.1', () => console.log(`[mmir] Local transport: http://127.0.0.1:${port}; gateway chat not yet verified.`))
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown() })
  } catch (error) { console.error('[mmir]', publicError(error).message); process.exitCode = 1 }
}
