/** Use Jarvis's existing voice preference, without replacing browser speech APIs. */
export const speechLanguage = import.meta.env.VITE_VOICE_LANGUAGE?.trim() || 'nb-NO'
export function chooseLocaleVoice(): void {
  if (import.meta.env.VITE_MMIR_MODE === '0' || typeof speechSynthesis === 'undefined') return
  try {
    // Never override the voice the user explicitly selected in Jarvis.
    if (localStorage.getItem('jarvis.voice')) return
    const language = speechLanguage.toLowerCase().split('-')[0]
    const matches = speechSynthesis.getVoices().filter(v => {
      const code = v.lang.toLowerCase().split(/[-_]/)[0]
      return language === 'nb' || language === 'no' ? ['nb', 'no'].includes(code) : code === language
    })
    const voice = matches.find(v => v.localService) ?? matches[0]
    if (voice) localStorage.setItem('jarvis.voice', voice.name)
  } catch { /* An unavailable preference store must not stop startup. */ }
}
// Loaded before App/tts so a voiceschanged event saves the locale preference before
// the existing TTS listener re-selects its cached voice. Only installed voices count.
if (import.meta.env.VITE_MMIR_MODE !== '0') {
  document.documentElement.lang = speechLanguage
  chooseLocaleVoice()
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener('voiceschanged', chooseLocaleVoice)
}
