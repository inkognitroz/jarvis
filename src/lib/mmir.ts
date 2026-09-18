import type { AskHandlers } from './anthropic'
import type { ConnectionState } from './bridge'
import { BRIDGE_HTTP_URL } from '../config'

type Message = { role: 'user' | 'assistant'; content: string }
export type MmirEvidence = { model: string | null; mmir: Record<string, unknown> | null;
  finishReason: string | null; receiptVerified: false }
// Bounded transcript replay for MMIR's stateless chat API. No persisted memory or routing.
let transcript: Message[] = []
let pending: AbortController | null = null
let connected = false
let connectedBefore = false
let labels = ['MMIR · ikke tilkoblet']
let onServers: ((servers: string[]) => void) | null = null
let onConnection: ((state: ConnectionState) => void) | null = null
let lastEvidence: MmirEvidence | null = null
export const evidence = () => lastEvidence
export const connectedLabels = () => [...labels]
export const isConnected = () => connected
export function watchServers(fn: (servers: string[]) => void) { onServers = fn; fn([...labels]) }
export function watchConnection(fn: (state: ConnectionState) => void) { onConnection = fn }
function mark(value: boolean) {
  if (connected === value) return
  connected = value
  onConnection?.(value ? connectedBefore ? 'reconnected' : 'open' : 'lost')
  if (value) connectedBefore = true
}
function announce(next: string[]) { labels = next; onServers?.([...labels]) }
export async function warm() {
  try {
    const response = await fetch(`${BRIDGE_HTTP_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const health = await response.json()
    if (!response.ok || health.backend !== 'mmir') throw new Error('Feil bridge: start Jarvis med npm run start:mmir.')
    mark(true)
    if (!lastEvidence) announce(['MMIR · lokal kobling klar, svarmodell ikke testet'])
  } catch (error) {
    mark(false)
    throw error instanceof Error ? error : new Error('MMIR-koblingen svarer ikke.')
  }
}
export function cancel() { pending?.abort(); pending = null }
export async function ask(prompt: string, handlers: AskHandlers): Promise<{ text: string; tools: string[] }> {
  cancel()
  if (!prompt.trim() || prompt.length > 8000) throw new Error('Spørsmålet er tomt eller for langt.')
  const controller = new AbortController()
  pending = controller
  let text = '', complete = false
  try {
    if (!connected) await warm()
    if (controller.signal.aborted) return { text: '', tools: [] }
    const history = [...transcript]
    while (history.length && history.reduce((n, m) => n + m.content.length, 0) + prompt.length > 20000) history.splice(0, 2)
    const messages: Message[] = [...history, { role: 'user', content: prompt }]
    const response = await fetch(`${BRIDGE_HTTP_URL}/mmir/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]),
    })
    if (!response.ok) throw new Error(`MMIR-koblingen avviste forespørselen (HTTP ${response.status}).`)
    if (!response.body || !response.headers.get('content-type')?.startsWith('application/x-ndjson')) throw new Error('MMIR-koblingen returnerte feil svarformat.')
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let buffer = '', bytes = 0
    const processLine = (line: string) => {
      if (!line.trim() || controller.signal.aborted) return
      const event = JSON.parse(line)
      if (event.type === 'error') throw new Error(typeof event.message === 'string' ? event.message : 'MMIR kunne ikke svare.')
      if (event.type === 'text' && typeof event.delta === 'string') {
        if (complete) throw new Error('MMIR returnerte tekst etter avsluttet svar.')
        text += event.delta; handlers.onText(event.delta)
      }
      if (event.type === 'done') {
        if (complete) throw new Error('MMIR returnerte flere avslutninger.')
        complete = true
        lastEvidence = { model: typeof event.model === 'string' ? event.model : null,
          mmir: event.mmir && typeof event.mmir === 'object' ? event.mmir : null,
          finishReason: typeof event.finishReason === 'string' ? event.finishReason : null, receiptVerified: false }
        announce(['MMIR', lastEvidence.model ? `Modell fra MMIR: ${lastEvidence.model}` : 'Modellnavn ikke oppgitt'])
        window.dispatchEvent(new CustomEvent('mmir:receipt', { detail: lastEvidence }))
      }
    }
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > 2 * 1024 * 1024) throw new Error('MMIR-svaret er for stort.')
        buffer += decoder.decode(next.value, { stream: true })
        let at
        while ((at = buffer.indexOf('\n')) !== -1) { processLine(buffer.slice(0, at)); buffer = buffer.slice(at + 1) }
      }
      buffer += decoder.decode(); if (buffer.trim()) processLine(buffer)
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    if (controller.signal.aborted) return { text: '', tools: [] }
    if (!complete || !text.trim()) throw new Error('MMIR-svaret ble ikke fullført.')
    transcript = [...messages, { role: 'assistant' as const, content: text }].slice(-16)
    return { text: text.trim(), tools: [] }
  } catch (error) {
    if (controller.signal.aborted) return { text: '', tools: [] }
    // Never silently fall back to Claude, GPT, a local model, or a synthetic answer.
    throw error instanceof Error ? error : new Error('MMIR-forespørselen feilet.')
  } finally { if (pending === controller) pending = null }
}
