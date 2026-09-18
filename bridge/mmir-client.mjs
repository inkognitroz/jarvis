/** MMIR transport only: no provider SDK, routing, MCP, shell or persistent memory. */
export const VOICE_CONTEXT = 'Du er MMIR. Brukeren snakker med deg gjennom Jarvis-grensesnittet. Svar på samme språk som brukeren, normalt norsk bokmål. Svar naturlig og kort for opplesning, normalt to til fire setninger, med mindre brukeren ber om mer. Ikke påstå at du har brukt verktøy, minne, søk eller utført handlinger uten faktisk grunnlag. Jarvis er grensesnittet, ikke en egen modell.'
const LIMIT = 1024 * 1024

export class MmirError extends Error {
  constructor(code, status = 502) {
    super(code)
    this.name = 'MmirError'
    this.code = code
    this.status = status
  }
}

export function gatewayBase(raw = 'https://api.mmir.ai/v1') {
  let u
  try { u = new URL(raw) } catch { throw new MmirError('invalid_gateway', 400) }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  const production = u.hostname === 'api.mmir.ai' && u.protocol === 'https:' && (!u.port || u.port === '443')
  if ((!production && !(local && ['http:', 'https:'].includes(u.protocol))) ||
      u.username || u.password || u.search || u.hash || !['', '/', '/v1', '/v1/'].includes(u.pathname)) {
    throw new MmirError('invalid_gateway', 400)
  }
  return `${u.origin}/v1`
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 25) throw new MmirError('invalid_messages', 400)
  let size = 0
  const clean = messages.map(m => {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) {
      throw new MmirError('invalid_messages', 400)
    }
    size += m.content.length
    return { role: m.role, content: m.content }
  })
  if (size > 24000 || clean.at(-1).role !== 'user') throw new MmirError('invalid_messages', 400)
  return clean
}

export function publicError(error) {
  const status = error instanceof MmirError ? error.status : 502
  const code = error instanceof MmirError ? error.code : 'gateway_unreachable'
  const known = {
    gateway_unreachable: 'Får ikke kontakt med MMIR. Kontroller nettverket og MMIR-status.',
    gateway_timeout: 'MMIR brukte for lang tid på å svare. Forespørselen er avbrutt.',
    connected_writers_unavailable: 'MMIR har ingen tilgjengelig svarmodell akkurat nå.',
    invalid_messages: 'Spørsmålet eller samtalen er for stor eller har ugyldig format.',
    empty_answer: 'MMIR returnerte ikke noe tekstsvar.',
    incomplete_stream: 'Forbindelsen til MMIR ble brutt før svaret var fullført.',
    invalid_response: 'MMIR returnerte et svarformat Jarvis ikke kan lese.',
    response_too_large: 'MMIR-svaret oversteg størrelsesgrensen.',
    invalid_gateway: 'MMIR-adressen er ugyldig. Bruk api.mmir.ai eller en lokal MMIR-gateway.',
  }
  const message = known[code] ?? (status === 401 || status === 403
    ? 'MMIR avviste tilgangen. Kontroller gatewayens autentisering på serversiden.'
    : status === 429 ? 'MMIR har nådd en kapasitetsgrense. Prøv igjen senere.'
    : status === 503 ? 'MMIR er utilgjengelig akkurat nå.' : `MMIR-forespørselen feilet (HTTP ${status}).`)
  // Never echo raw upstream bodies, URLs, credentials or stack traces to the browser.
  return { code, message, status }
}

async function readBounded(response) {
  if (!response.body) throw new MmirError('invalid_response')
  let size = 0
  const pieces = []
  const reader = response.body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > LIMIT) throw new MmirError('response_too_large')
      pieces.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return new TextDecoder().decode(Buffer.concat(pieces))
}

export async function chatMmir(messages, {
  baseUrl = 'https://api.mmir.ai/v1', apiKey = '', signal,
  timeoutMs = 45000, fetchImpl = fetch, onEvent = () => {},
} = {}) {
  const base = gatewayBase(baseUrl)
  const clean = validateMessages(messages)
  const deadline = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  let response
  let text = ''
  let model = null
  let metadata = null
  let finishReason = null
  let terminal = false
  const evidence = frame => {
    if (typeof frame.model === 'string') model = frame.model
    if (frame.mmir && typeof frame.mmir === 'object') metadata = frame.mmir
  }
  const accept = frame => {
    if (!frame || typeof frame !== 'object') throw new MmirError('invalid_response')
    if (frame.error) {
      const code = typeof frame.error === 'object' ? frame.error.code : frame.error
      throw new MmirError(code === 'connected_writers_unavailable' ? code : 'invalid_response')
    }
    evidence(frame)
    const choice = frame.choices?.[0]
    const delta = choice?.delta?.content ?? choice?.message?.content
    if (typeof delta === 'string' && delta) { text += delta; onEvent({ type: 'text', delta }) }
    if (choice?.finish_reason != null) { finishReason = choice.finish_reason; terminal = true }
  }
  try {
    response = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: combined,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream, application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: 'supergeni', stream: true, max_tokens: 256,
        messages: [{ role: 'system', content: VOICE_CONTEXT }, ...clean] }),
    })
    if (!response.ok) {
      let code = 'gateway_error'
      try {
        const body = JSON.parse(await readBounded(response))
        const upstream = typeof body.error === 'string' ? body.error : body.error?.code
        if (upstream === 'connected_writers_unavailable') code = upstream
      } catch { /* raw upstream diagnostics are deliberately not exposed */ }
      throw new MmirError(code, response.status)
    }
    const type = response.headers.get('content-type') ?? ''
    if (/^application\/json\b/i.test(type)) {
      let data
      try { data = JSON.parse(await readBounded(response)) } catch (e) {
        if (e instanceof MmirError) throw e
        throw new MmirError('invalid_response')
      }
      accept(data)
      terminal = true // JSON is one complete answer, not simulated token streaming.
    } else if (/^text\/event-stream\b/i.test(type)) {
      if (!response.body) throw new MmirError('invalid_response')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = '', event = [], size = 0, doneMarker = false
      const dispatch = () => {
        if (!event.length) return
        const raw = event.join('\n'); event = []
        if (raw.trim() === '[DONE]') { terminal = true; doneMarker = true; return }
        let frame
        try { frame = JSON.parse(raw) } catch { throw new MmirError('invalid_response') }
        accept(frame)
      }
      const line = value => {
        const s = value.replace(/\r$/, '')
        if (!s) dispatch()
        else if (s.startsWith('data:')) event.push(s.slice(5).replace(/^ /, ''))
      }
      try {
        while (!doneMarker) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > LIMIT) throw new MmirError('response_too_large')
          pending += decoder.decode(chunk.value, { stream: true })
          let at
          while (!doneMarker && (at = pending.indexOf('\n')) !== -1) {
            line(pending.slice(0, at)); pending = pending.slice(at + 1)
          }
        }
        if (!doneMarker) { pending += decoder.decode(); if (pending) line(pending); dispatch() }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    } else throw new MmirError('invalid_response')
    if (!terminal) throw new MmirError('incomplete_stream')
    if (!text.trim()) throw new MmirError('empty_answer')
    if (combined.aborted) throw combined.reason
    const result = { text: text.trim(), model, mmir: metadata, finishReason,
      receiptVerified: false } // A received receipt is NOT independently verified.
    onEvent({ type: 'done', ...result })
    return result
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (deadline.aborted) throw new MmirError('gateway_timeout', 504)
    if (error instanceof MmirError) throw error
    throw new MmirError('gateway_unreachable', 502)
  }
}
