#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gatewayBase, chatMmir, publicError } from '../bridge/mmir-client.mjs'

process.chdir(fileURLToPath(new URL('../', import.meta.url)))
const [major, minor] = process.versions.node.split('.').map(Number)
const supported = major === 20 && minor >= 19 || major === 22 && minor >= 12 || major >= 24
console.log(`[${supported ? 'OK' : 'FAIL'}] Node ${process.versions.node}`)
console.log(`[${existsSync('node_modules/vite/bin/vite.js') ? 'OK' : 'MISSING'}] Frontend dependencies`)
console.log('[INFO] Claude Code and ~/.claude.json are not required or inspected.')
console.log('[INFO] Microphone, installed Norwegian voice and real audio must be tested in Chrome/Edge.')
if (!supported) process.exit(1)
let base
try { base = gatewayBase(process.env.MMIR_BASE_URL || 'https://api.mmir.ai/v1') }
catch (error) { console.error('[FAIL]', publicError(error).message); process.exit(1) }
try {
  const models = await fetch(`${base}/models`, { redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: process.env.MMIR_API_KEY ? { authorization: `Bearer ${process.env.MMIR_API_KEY}` } : {} })
  if (!models.ok) throw new Error(`HTTP ${models.status}`)
  const body = await models.json()
  const present = Array.isArray(body.data) && body.data.some(m => m.id === 'supergeni')
  console.log(`[${present ? 'OK' : 'WARN'}] MMIR model catalog: supergeni ${present ? 'listed' : 'not listed'}. This is NOT proof of a working answer.`)
  if (!present) process.exitCode = 1
} catch { console.error('[FAIL] Could not verify MMIR model catalog (network/access/status).'); process.exitCode = 1 }
if (process.argv.includes('--chat')) {
  console.log('[INFO] Running one explicit supergeni chat request. No provider fallback or retries.')
  try {
    const answer = await chatMmir([{ role: 'user', content: 'Svar kort på norsk: Hva er hovedstaden i Norge?' }],
      { baseUrl: base, apiKey: process.env.MMIR_API_KEY || '' })
    console.log(JSON.stringify({ answer: answer.text, model: answer.model, mmir: answer.mmir,
      receiptVerified: false, microphoneTested: false }, null, 2))
  } catch (error) { console.error('[FAIL]', publicError(error).message); process.exitCode = 1 }
} else console.log('[INFO] No chat request made. Run npm run doctor:mmir -- --chat for a real gateway answer test.')
