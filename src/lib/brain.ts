import * as bridge from './bridge'
import * as direct from './anthropic'
import * as mmir from './mmir'
import { BACKEND } from '../config'
import type { AskHandlers, Msg } from './anthropic'
import type { Blade, Panel } from '../store'
export type { AskHandlers, Msg }
export type { ConnectionState } from './bridge'

/** MMIR is the default. Legacy Claude is an explicit opt-in, never a fallback. */
export const usingMmir = import.meta.env.VITE_MMIR_MODE !== '0'
export const usingBridge = usingMmir || BACKEND === 'bridge'
const legacyBridge = !usingMmir && BACKEND === 'bridge'

export async function ask(prompt: string, history: Msg[], handlers: AskHandlers): Promise<{ text: string; tools: string[] }> {
  if (usingMmir) return mmir.ask(prompt, handlers)
  if (legacyBridge) return bridge.ask(prompt, handlers)
  return direct.ask([...history, { role: 'user', content: prompt }], handlers)
}
export async function warm(): Promise<void> {
  if (usingMmir) await mmir.warm()
  else if (legacyBridge) await bridge.warmBridge()
}
export function watchServers(fn: (servers: string[]) => void): void {
  if (usingMmir) mmir.watchServers(fn)
  else if (legacyBridge) bridge.watchServers(fn)
}
export function watchPanels(fn: (panel: Panel) => void): void { if (legacyBridge) bridge.watchPanels(fn) }
export function watchBlades(fn: (blade: Blade) => void): void { if (legacyBridge) bridge.watchBlades(fn) }
export function watchUi(fn: (op: string, args: any) => void): void { if (legacyBridge) bridge.watchUi(fn) }
export function watchCapture(fn: (req: bridge.CaptureRequest) => Promise<bridge.CaptureResult>): void {
  if (legacyBridge) bridge.watchCapture(fn)
}
export function cancel(): void {
  if (usingMmir) mmir.cancel()
  else if (legacyBridge) bridge.cancel()
  else direct.cancel()
}
export function interrupt(): void { cancel() }
export function isConnected(): boolean { return usingMmir ? mmir.isConnected() : legacyBridge ? bridge.isConnected() : true }
export function watchConnection(fn: (state: bridge.ConnectionState) => void): void {
  if (usingMmir) mmir.watchConnection(state => fn(state === 'reconnected' ? 'open' : state))
  else if (legacyBridge) bridge.watchConnection(fn)
}
export function connectedLabels(): string[] {
  if (usingMmir) return mmir.connectedLabels()
  if (legacyBridge) return bridge.bridgeServers()
  return direct.connectedLabels()
}
