import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const mmir = process.env.VITE_MMIR_MODE !== '0'
const language = process.env.VITE_VOICE_LANGUAGE || 'nb-NO'
if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language)) throw new Error('Invalid VITE_VOICE_LANGUAGE')

export default defineConfig({
  plugins: [react()],
  // MMIR mode deliberately ignores legacy .env files and automatic VITE_* export.
  // Only these non-secret presentation values enter the browser, in dev AND build.
  envDir: mmir ? false : undefined,
  envPrefix: mmir ? [] : 'VITE_',
  define: mmir ? {
    'import.meta.env.VITE_MMIR_MODE': JSON.stringify('1'),
    'import.meta.env.VITE_BACKEND': JSON.stringify('bridge'),
    'import.meta.env.VITE_BRIDGE_URL': JSON.stringify('ws://127.0.0.1:8787'),
    'import.meta.env.VITE_TTS_ENGINE': JSON.stringify('system'),
    'import.meta.env.VITE_USE_ELEVENLABS': JSON.stringify('false'),
    'import.meta.env.VITE_VOICE_LANGUAGE': JSON.stringify(language),
  } : {},
  server: { host: '127.0.0.1', port: Number(process.env.PORT) || 5173, strictPort: mmir },
  optimizeDeps: { exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'] },
})
