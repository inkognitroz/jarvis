#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { gatewayBase } from '../bridge/mmir-client.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)
const [major, minor] = process.versions.node.split('.').map(Number)
if (!(major === 20 && minor >= 19 || major === 22 && minor >= 12 || major >= 24)) {
  console.error('Unsupported Node.js. Use Node 22.12+ or a newer supported LTS release.'); process.exit(1)
}
if (!existsSync('node_modules/vite/bin/vite.js')) {
  console.error('Dependencies are missing. Run bash scripts/install-mmir-mac.sh first.'); process.exit(1)
}
// The checked-in CSP permits bridge HTTP on 8787. Do not silently change that port.
if (process.env.JARVIS_BRIDGE_PORT && process.env.JARVIS_BRIDGE_PORT !== '8787') {
  console.error('MMIR voice uses bridge port 8787. A port change also requires a reviewed CSP change.'); process.exit(1)
}
const uiPort = Number(process.env.PORT || 5173)
if (!Number.isInteger(uiPort) || uiPort < 5173 || uiPort > 5199) {
  console.error('PORT must be 5173–5199 for this local launcher.'); process.exit(1)
}
try { gatewayBase(process.env.MMIR_BASE_URL || 'https://api.mmir.ai/v1') }
catch { console.error('Invalid MMIR_BASE_URL. No processes started.'); process.exit(1) }
for (const port of [uiPort, 8787]) {
  const free = await new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
  if (!free) { console.error(`Port ${port} is occupied. Nothing was stopped or replaced.`); process.exit(1) }
}
const wasm = 'node_modules/@mediapipe/tasks-vision/wasm'
if (existsSync(wasm) && !existsSync('public/mediapipe/vision_wasm_internal.wasm')) {
  mkdirSync('public/mediapipe', { recursive: true }); cpSync(wasm, 'public/mediapipe', { recursive: true })
}
const children = []
let stopping = false
function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  // Only our own child processes, never unrelated listeners or other projects.
  setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); process.exit(code) }, 1500).unref()
  process.exitCode = code
}
function run(name, args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  child.stdout.on('data', data => process.stdout.write(`[${name}] ${data}`))
  child.stderr.on('data', data => process.stderr.write(`[${name}] ${data}`))
  child.once('error', () => { console.error(`[${name}] could not start`); shutdown(1) })
  child.once('exit', code => { if (!stopping) shutdown(code || 1) })
}
const backendEnv = { ...process.env, PORT: String(uiPort), JARVIS_BRIDGE_PORT: '8787' }
const frontendEnv = { ...process.env, VITE_MMIR_MODE: '1', VITE_BACKEND: 'bridge',
  VITE_BRIDGE_URL: 'ws://127.0.0.1:8787', VITE_TTS_ENGINE: 'system', VITE_USE_ELEVENLABS: 'false',
  VITE_ANTHROPIC_API_KEY: '', VITE_ELEVENLABS_API_KEY: '', VITE_PICOVOICE_ACCESS_KEY: '',
  VITE_VOICE_LANGUAGE: process.env.VITE_VOICE_LANGUAGE || 'nb-NO' }
delete frontendEnv.MMIR_API_KEY
run('MMIR', ['bridge/mmir-server.mjs'], backendEnv)
run('Jarvis', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], frontendEnv)
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => shutdown(0))
console.log(`\nJARVIS → MMIR. Open http://127.0.0.1:${uiPort} in Chrome or Edge.\nNo Claude login, inherited MCP or local write actions. Ctrl-C stops this launch only.\n`)
if (process.argv.includes('--open') && process.platform === 'darwin') {
  // Wait for both servers before opening a real browser. Never click microphone consent.
  for (let i = 0; i < 40 && !stopping; i++) {
    await new Promise(resolve => setTimeout(resolve, 250))
    try {
      const checks = await Promise.all([fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(1000) }), fetch(`http://127.0.0.1:${uiPort}`, { signal: AbortSignal.timeout(1000) })])
      if (!checks.every(r => r.ok)) continue
      const browser = existsSync('/Applications/Google Chrome.app') ? 'Google Chrome'
        : existsSync('/Applications/Microsoft Edge.app') ? 'Microsoft Edge' : null
      if (browser) spawn('open', ['-a', browser, `http://127.0.0.1:${uiPort}`], { stdio: 'ignore' }).on('error', () => {})
      break
    } catch { /* startup still in progress */ }
  }
}
