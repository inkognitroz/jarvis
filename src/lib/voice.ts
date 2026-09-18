import { BRIDGE_HTTP_URL } from '../config'
import { getMic } from './audio'
import { speakingNow, speakingSince } from './tts'
import { startVad, type Vad } from './vad'
import { caps } from './capabilities'

// The upstream continuous voice loop, with a configurable recognition locale.
// One recogniser stays alive across turns; the assembler joins sentence fragments,
// echo filtering protects barge-in, and the heartbeat recovers a stalled browser.
export type VoiceMode = 'wake' | 'command' | 'guard' | 'deaf'
export type VoiceHandlers = {
  mode: () => VoiceMode
  onWake: (trailing: string) => void
  onSpeechStart: () => void
  onPartial: (text: string) => void
  onUtterance: (text: string) => void
  onError: (message: string) => void
}
export type Voice = { stop: () => void; live: () => boolean }

const LANGUAGE = import.meta.env.VITE_VOICE_LANGUAGE?.trim() || 'en-GB'
const WAKE_DEBOUNCE = 1500
const WAKE = /\b(?:hey|hei|hi|ok|okay|yo)?\s*(?:jarvis|jarvys|jervis|jarvis's|travis|jarviss|java's|jarv)\b(?!'s)/i
function afterWake(text: string): string {
  const m = WAKE.exec(text)
  if (!m) return ''
  return text.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+/, '').trim()
}

// Keep English endpointing; include common Norwegian unfinished-clause endings.
const CONTINUES = /\b(and|or|but|so|because|since|if|when|while|that|which|who|whose|to|of|in|on|at|by|for|with|from|about|into|onto|over|under|between|through|the|a|an|my|your|his|her|its|our|their|is|are|was|were|be|been|do|does|did|have|has|had|can|could|would|should|will|shall|might|must|like|than|then|as|very|really|just|some|any|all|both|either|neither|og|eller|men|fordi|hvis|som|til|fra|med|om|av|er|var|har|kan|skal|vil|den|det|en|et)$/i
const TRAILS = /[,;:–—-]$/
const SELF_GUARD_MS = 350
const SETTLE_MS = 250
const CONTINUE_MS = 1600
const MAX_HOLD_MS = 6000
function holdFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return CONTINUE_MS
  if (/[.!?]$/.test(text)) return 0
  if (TRAILS.test(text.trim()) || CONTINUES.test(words[words.length - 1])) return CONTINUE_MS
  if (words.length <= 2 && !OVERRIDE.test(text)) return CONTINUE_MS
  return SETTLE_MS
}
type Assembler = {
  feed: (text: string, active: boolean) => void
  flush: () => void
  cancel: () => void
  held: () => string
}
function makeAssembler(h: { emit: (text: string) => void; partial: (text: string) => void }): Assembler {
  let held = '', firstAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (timer) clearTimeout(timer); timer = null }
  const fire = () => {
    clear()
    const text = held.trim()
    held = ''; firstAt = 0
    if (text) h.emit(text)
  }
  return {
    feed(text, active) {
      if (!text.trim()) return
      held = `${held} ${text}`.replace(/\s+/g, ' ').trim()
      if (!firstAt) firstAt = Date.now()
      h.partial(held); diag.holding = held; clear()
      if (active) { timer = setTimeout(fire, MAX_HOLD_MS); return }
      const wait = Math.min(holdFor(held), Math.max(0, MAX_HOLD_MS - (Date.now() - firstAt)))
      diag.waitedMs = wait
      if (wait === 0) { fire(); return }
      timer = setTimeout(fire, wait)
    },
    flush: fire,
    cancel() { clear(); held = ''; firstAt = 0; diag.holding = '' },
    held: () => held,
  }
}

// Unicode letters preserve Norwegian æ/ø/å in the echo comparison.
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim()
const OVERRIDE = /\b(stop|stopp|vent|avbryt|nok|stille|nei|wait|jarvis|cancel|enough|quiet|hold on|shut up|never ?mind|forget it|no)\b/i
const STOP = new Set((
  'a an the and or but so of to in on at by for with from is are was were be ' +
  'it its this that these those i you he she we they me him her them my your ' +
  'our their what which who how why when where do does did can could would ' +
  'should will shall not no yes if then than as about into over under out up ' +
  'down one two three first second third now here there just very really got ' +
  'get have has had say said tell me okay ok well right ' +
  'og eller men av til i på for med fra er var være det den de jeg du han hun vi dere ' +
  'meg deg oss min din vår hva hvem hvor hvordan hvorfor når kan vil skal har hadde ' +
  'ikke ja nei hvis så enn om ut opp ned en to tre første andre nå her der bare veldig'
).split(' '))
function isEcho(heard: string, spoken: string): boolean {
  if (!spoken || OVERRIDE.test(heard)) return false
  const all = norm(heard).split(' ').filter(Boolean)
  if (!all.length) return true
  const mine = new Set(norm(spoken).split(' '))
  const content = all.filter(w => !STOP.has(w))
  if (content.length < 2) return all.length >= 2 && all.every(w => mine.has(w))
  let hits = 0
  for (const w of content) if (mine.has(w)) hits++
  return hits / content.length >= 0.6
}

export const diag = {
  engine: 'browser', running: false, sessions: 0, heard: '', heardAt: 0,
  lastError: '', wakes: 0, mode: '', dropped: '', accepted: 0, holding: '',
  waitedMs: 0, selfGuarded: 0, restarts: 0, idleMs: 0, language: LANGUAGE,
}
function drop(why: string) { diag.dropped = why }
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__voice = diag

export async function startVoice(h: VoiceHandlers): Promise<Voice> {
  try { await getMic() }
  catch (err) {
    diag.lastError = 'mic'
    h.onError(err instanceof DOMException && err.name === 'NotAllowedError'
      ? 'Microphone access denied — voice input is unavailable.' : 'No microphone available.')
    return { stop: () => {}, live: () => false }
  }
  diag.engine = caps().stt ? 'elevenlabs' : 'browser'
  return caps().stt ? startElevenVoice(h) : startBrowserVoice(h)
}

// Legacy premium speech path. The MMIR bridge reports stt=false and never reads keys.
async function startElevenVoice(h: VoiceHandlers): Promise<Voice> {
  let lastWake = 0, draining = false
  let vad: Vad | null = null
  const pendingAudio: Blob[] = []
  const assemble = makeAssembler({
    emit: text => { diag.dropped = ''; diag.accepted++; diag.holding = ''; h.onUtterance(text) },
    partial: text => h.onPartial(text),
  })
  const transcribe = async (blob: Blob) => {
    const mode = h.mode()
    if (mode === 'deaf') return
    const t0 = performance.now()
    try {
      const res = await fetch(`${BRIDGE_HTTP_URL}/stt`, {
        method: 'POST', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob,
      })
      diag.idleMs = Math.round(performance.now() - t0)
      if (!res.ok) { diag.restarts++; diag.lastError = `stt ${res.status}`; drop(`transcription failed (${res.status})`); return }
      const { text } = await res.json() as { text?: string }
      const said = (text ?? '').trim()
      diag.lastError = ''
      if (!said) { drop('nothing intelligible in the segment'); return }
      if (isEcho(said, speakingNow())) { drop('echo of his own voice'); return }
      diag.heard = said; diag.heardAt = Date.now()
      if (mode === 'wake') {
        if (WAKE.test(said) && Date.now() - lastWake > WAKE_DEBOUNCE) {
          lastWake = Date.now(); diag.wakes++; diag.dropped = ''; diag.accepted++; h.onWake(afterWake(said))
        } else drop(`heard "${said.slice(-40)}" — not his name`)
        return
      }
      assemble.feed(said, vad?.meter().speaking ?? false)
    } catch (err) { diag.restarts++; diag.lastError = String(err); drop('could not reach the speech service') }
  }
  const drain = async () => {
    if (draining) return
    draining = true
    try { while (pendingAudio.length) await transcribe(pendingAudio.shift()!) }
    finally { draining = false }
  }
  vad = await startVad({
    onStart: () => {
      const mode = h.mode(); diag.mode = mode; diag.sessions++
      if (mode === 'deaf') return
      if (mode === 'wake') assemble.cancel()
      if (mode === 'guard') {
        const since = speakingSince()
        if (since && Date.now() - since < SELF_GUARD_MS) { diag.selfGuarded++; return }
        h.onSpeechStart()
      }
    },
    onEnd: blob => { pendingAudio.push(blob); void drain() },
    onLevel: v => { if (h.mode() === 'command' && !assemble.held()) h.onPartial(v > 0.04 ? '…' : '') },
    onError: message => { diag.lastError = 'capture'; diag.running = false; h.onError(message) },
  })
  diag.running = vad.live()
  const guardPoll = setInterval(() => {
    const mode = h.mode(); vad?.setGuard(mode === 'guard')
    if ((mode === 'wake' || mode === 'deaf') && assemble.held()) assemble.cancel()
  }, 200)
  return {
    stop: () => { clearInterval(guardPoll); assemble.cancel(); vad?.stop(); diag.running = false },
    live: () => vad?.live() ?? false,
  }
}

function startBrowserVoice(h: VoiceHandlers): Voice {
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  if (!Ctor) {
    h.onError('This browser has no speech recognition — use Chrome or Edge.')
    return { stop: () => {}, live: () => false }
  }
  let stopped = false, running = false, rec: any = null
  let settled = '', interim = '', started = false, barged = false, lastWake = 0
  let lastAlive = Date.now()
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  const assemble = makeAssembler({
    emit: text => { diag.dropped = ''; diag.accepted++; diag.holding = ''; h.onUtterance(text) },
    partial: text => h.onPartial(text),
  })
  const touch = () => { lastAlive = Date.now() }
  const clearSilence = () => { if (silenceTimer) clearTimeout(silenceTimer); silenceTimer = null }
  const reset = () => { clearSilence(); settled = ''; interim = ''; started = false; barged = false }
  const emit = () => {
    const text = `${settled} ${interim}`.replace(/\s+/g, ' ').trim()
    const mode = h.mode(); reset()
    if (!text || mode === 'deaf') return
    if (isEcho(text, speakingNow())) { drop('echo of his own voice'); return }
    diag.heard = text; diag.heardAt = Date.now()
    if (mode === 'wake') {
      assemble.cancel()
      if (WAKE.test(text) && Date.now() - lastWake > WAKE_DEBOUNCE) {
        lastWake = Date.now(); diag.wakes++; diag.dropped = ''; diag.accepted++; h.onWake(afterWake(text))
      } else drop(`heard "${text.slice(-40)}" — not his name`)
      return
    }
    assemble.feed(text, false)
  }
  const bumpSilence = () => { clearSilence(); silenceTimer = setTimeout(emit, 900) }
  const onResult = (e: any) => {
    touch()
    const mode = h.mode(); diag.mode = mode
    if (mode === 'deaf') { interim = ''; return }
    let fresh = ''; interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript as string
      if (e.results[i].isFinal) fresh += chunk
      else interim += chunk
    }
    const heard = `${settled}${fresh} ${interim}`.replace(/\s+/g, ' ').trim()
    if (!heard) return
    if (isEcho(`${fresh} ${interim}`, speakingNow())) { interim = ''; return }
    if (mode === 'wake') {
      settled += fresh
      if (WAKE.test(heard) && Date.now() - lastWake > WAKE_DEBOUNCE) {
        lastWake = Date.now(); diag.wakes++
        const trailing = afterWake(heard); reset(); h.onWake(trailing)
      } else if (settled.length > 400) settled = ''
      return
    }
    settled += fresh
    const full = `${settled} ${interim}`.replace(/\s+/g, ' ').trim()
    if (!started || (mode === 'guard' && !barged)) {
      const words = full.split(/\s+/).filter(Boolean).length
      if (mode === 'guard' && !OVERRIDE.test(full)) {
        const since = speakingSince()
        if (since && Date.now() - since < SELF_GUARD_MS) { diag.selfGuarded++; return }
        if (words < 2) return
      }
      started = true
      if (mode === 'guard') barged = true
      h.onSpeechStart()
    }
    diag.dropped = ''
    const carried = assemble.held()
    h.onPartial(carried ? `${carried} ${full}` : full)
    bumpSilence()
  }
  const spin = () => {
    if (stopped || running) return
    rec = new Ctor()
    rec.continuous = true; rec.interimResults = true; rec.lang = LANGUAGE
    rec.onstart = () => { running = true; diag.running = true; diag.sessions++; touch() }
    rec.onresult = onResult
    rec.onerror = (ev: any) => {
      diag.lastError = String(ev.error ?? '')
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        stopped = true; diag.running = false; h.onError('Microphone access was refused — voice input is unavailable.')
      }
    }
    rec.onend = () => { running = false; diag.running = false; touch(); rec = null; if (!stopped) setTimeout(spin, 80) }
    try { rec.start() } catch { running = false; setTimeout(spin, 250) }
  }
  spin()
  const health = setInterval(() => {
    if (stopped) return
    const idle = Date.now() - lastAlive; diag.idleMs = idle
    if (idle < 15000) return
    diag.restarts++
    try { rec?.abort() } catch { /* already gone */ }
    rec = null; running = false; diag.running = false; touch(); spin()
  }, 5000)
  return {
    stop: () => {
      stopped = true; clearInterval(health); clearSilence(); assemble.cancel(); diag.running = false
      try { rec?.abort() } catch { /* already gone */ }
    },
    live: () => running,
  }
}
