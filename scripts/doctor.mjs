#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

const ok = (m) => console.log(`[ ok ] ${m}`)
const warn = (m) => console.log(`[warn] ${m}`)
const info = (m) => console.log(`[ .. ] ${m}`)

function cmd(name, args=['--version']) {
  const r = spawnSync(name,args,{encoding:'utf8',timeout:10000})
  return {ok:r.status===0, out:(r.stdout||r.stderr||'').trim()}
}
function portFree(port){
  return new Promise((resolve)=>{
    const s=net.createServer()
    s.once('error',()=>resolve(false))
    s.once('listening',()=>s.close(()=>resolve(true)))
    s.listen(port,'127.0.0.1')
  })
}

console.log('\nJARVIS doctor\n-------------')
const [maj,min] = process.versions.node.split('.').map(Number)
if (maj>20 || (maj===20 && min>=19)) ok(`Node ${process.versions.node}`)
else warn(`Node ${process.versions.node}; Vite 8 requires Node 20.19+ or 22.12+`)

for (const name of ['git','npm']) {
  const r=cmd(name)
  r.ok?ok(`${name}: ${r.out}`):warn(`${name} not available`)
}
const claude=cmd('claude')
claude.ok?ok(`Claude Code: ${claude.out}`):warn('Claude Code not found or not logged in')

const cfg=join(homedir(),'.claude.json')
if (existsSync(cfg)) {
  try {
    const j=JSON.parse(readFileSync(cfg,'utf8'))
    const global=j.mcpServers??{}
    const scoped=j.projects?.[homedir()]?.mcpServers??{}
    const names=[...new Set([...Object.keys(global),...Object.keys(scoped)])].sort()
    ok(`Claude config found; MCP servers: ${names.length}`)
    if(names.length) info(`MCP: ${names.join(', ')}`)
  } catch {
    warn('~/.claude.json exists but could not be parsed')
  }
} else warn('~/.claude.json not found yet')

for (const p of [5173,8787]) {
  ;(await portFree(p))?ok(`port ${p} is free`):warn(`port ${p} is already in use`)
}

if (process.platform==='darwin') {
  const chrome=existsSync('/Applications/Google Chrome.app')
  const edge=existsSync('/Applications/Microsoft Edge.app')
  chrome||edge?ok(`supported browser found: ${chrome?'Chrome':'Edge'}`):warn('Chrome/Edge not found in /Applications')
} else info(`platform: ${process.platform} (Mac launcher is macOS-specific)`)

console.log('\nRecommended first run: npm run start:safe\n')
