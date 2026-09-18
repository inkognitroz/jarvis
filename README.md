# JARVIS → MMIR

Jarvis is the voice and holographic interface. **MMIR is the intelligence underneath.**
This fork's default launch talks to `https://api.mmir.ai/v1/chat/completions` through a small loopback transport.
It requests `supergeni`; model selection, routing and access to providers remain in MMIR.

## Start on Mac

Use Node 22.12+ or a newer supported LTS release, and a real Chrome/Edge window.
From this repository:

```bash
bash scripts/install-mmir-mac.sh
npm start -- --open
```

After installation, `MMIR.command` is the double-click launcher. Click **INITIALISE**,
allow the microphone, then say **“Jarvis, hva er hovedstaden i Norge?”**. Space activates
listening without the wake word. D opens audio diagnostics. Ctrl-C stops this launch's children only.

Norwegian recognition (`nb-NO`) is the default. Jarvis selects an installed Norwegian
system voice when no explicit voice preference exists; it does not install voices or
promise Norwegian sound when the machine has none. Browser speech recognition may
send audio to the browser's speech service: this is not an offline STT guarantee.

## What is connected

```text
Microphone → browser speech recognition → Jarvis
→ local MMIR transport → MMIR /v1/chat/completions
→ streamed answer → Jarvis transcript + system speech
```

MMIR mode does not launch Claude Code, load `~/.claude.json`, inherit MCP servers,
serve local files or expose local write actions. The Claude implementation and locked
packages remain only for explicit legacy use; they are not the MMIR backend.

This is a **chat/voice integration**, not proof of camera-to-model, tools, durable memory
or account-wide history integration. The adapter retains only a bounded in-memory replay
of the current chat for the stateless MMIR endpoint. Reloading clears it.

## Verification

```bash
npm run test:mmir
npm run build
npm run lint
npm run doctor:mmir          # catalog probe, no model call
npm run doctor:mmir -- --chat # one real, bounded MMIR chat request
```

A local `/health` response proves only that the transport is running. It does not prove
that MMIR has an available writer. A received route receipt is preserved, **not claimed
cryptographically verified**. Gateway failures stay failures: there is no direct Claude,
GPT, local-model or synthetic-answer fallback.

See [MMIR-SETUP.md](MMIR-SETUP.md) for configuration, limits, actual test scope and rollback.
The unchanged upstream description is retained in [UPSTREAM-README.md](UPSTREAM-README.md).
Related architecture: `inkognitroz/inkognitroz.github.io#659`.

## Legacy mode

```bash
npm run start:claude
```

This explicitly returns to the upstream Claude/MCP behavior and its security considerations.
It is not required to talk to MMIR and is never selected as an error fallback.

MIT license retained. Original demo audio rights remain subject to upstream credits.
