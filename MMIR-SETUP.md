# MMIR voice setup and acceptance

## Architecture

Jarvis keeps the microphone, reactor, transcript and speech output. A small local HTTP
transport converts MMIR SSE/JSON into newline-delimited events for the existing voice UI.
It calls only MMIR's `/v1/chat/completions`, requesting `supergeni`. It does not select a
provider, execute tools, read Claude configuration, or create a second agent runtime.

The original Claude implementation is retained for `npm run start:claude` only. The older
`improve-macos-safety` branch is not a prerequisite and is not included in this change.
The dependency lockfile is preserved; legacy SDK packages remain installed but the MMIR
server neither imports nor starts the Claude Agent SDK.

## Installation and launch

Use a clean checkout of the MMIR integration branch. Never discard local changes to
switch branches. The installer stops at a failed dependency install, test, build or lint.

```bash
bash scripts/install-mmir-mac.sh
npm start -- --open
```

After installation, double-click `MMIR.command`. The launcher checks both ports before
starting, opens Chrome/Edge when available and never kills an unrelated port listener.
Stop with Ctrl-C in the launch terminal. It stops only the child processes it started.
No autostart, launch daemon, MMIR deployment or GitHub Actions job is installed.

The default UI is `http://127.0.0.1:5173`; transport is `http://127.0.0.1:8787`.
`PORT` may be 5173–5199. Bridge port 8787 remains fixed by the existing content-security
policy. A busy port is an explicit startup failure, not a reason to stop another project.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `MMIR_BASE_URL` | `https://api.mmir.ai/v1` | Only the canonical MMIR gateway or an explicit loopback gateway is accepted. |
| `MMIR_API_KEY` | unset | Optional MMIR gateway credential, server-side only; never a direct model-provider key. |
| `VITE_VOICE_LANGUAGE` | `nb-NO` | Recognition language, e.g. `en-GB` for English. |
| `PORT` | `5173` | UI port within the local development range. |

The MMIR build does **not** load legacy `.env` files or automatically export `VITE_*`
variables. It defines only reviewed, non-secret presentation settings. Pass settings in
the terminal environment; do not paste secrets into chat, source files or the browser.
There is no fallback to a paid provider or another backend when MMIR fails.

## Voice checks in a real browser

Click INITIALISE and approve the microphone. Say **“Jarvis, hva er hovedstaden i Norge?”**
or press Space and speak. Then ask a related follow-up without reintroducing the topic.
Interrupt an answer to test barge-in. D shows audio diagnostics; T tests output independently
of MMIR. A simulator cannot verify the actual microphone, acoustics or audible response.

Recognition uses `nb-NO`. Speech output selects an installed Norwegian system voice only
when there is no saved explicit Jarvis voice choice. A previously saved English voice is
not silently overwritten. With no Norwegian voice installed, the upstream system fallback
may speak with an unsuitable voice; select/install a Norwegian voice in macOS settings.
The original boot/filler prompts are not fully translated.

Browser speech recognition may use the browser vendor's remote speech service. This is
not an offline voice guarantee. Camera/hand tracking is local UI functionality only in this
slice; the MMIR adapter does not send camera frames or execute local tools.

## Truthful health and diagnostics

```bash
npm run doctor:mmir
npm run doctor:mmir -- --chat
```

The first command probes the catalog only. The second performs exactly one bounded
real `supergeni` request, with no retry or provider fallback. It prints the actual answer,
returned model and received route metadata. A failed catalog request or unavailable writer
is an error, not proof that another model answered.

The bridge `/health` returns `gatewayVerified:false`: local process health is not a live
model test. After a successful answer the SYSTEMS rail shows the model reported by MMIR.
`mmir:receipt` events carry the gateway's metadata. `receiptVerified:false` is deliberate:
this adapter does not possess an independent verifier or claim signature validation.

## Bounds and limitations

One request is made for each completed utterance, requesting at most 256 output tokens.
The gateway timeout is 45 seconds; the UI timeout is 55 seconds. Response size, message
size and concurrent requests are bounded. Cancel/disconnect aborts the upstream fetch.
Only current-chat replay is held in memory: at most 16 messages, trimmed before a request.
This is not a durable MMIR memory store, shared-account history, or a login/session bridge.
A page reload clears it. Backend policy, routing and durable state remain MMIR concerns.

## Validation recorded for this change

- **21 tests passed** in a Linux Node 22.16.0 test environment.
- Real loopback HTTP requests were exercised against a **mocked MMIR gateway**.
- Frontend adapter and recognition lifecycle tests use mocked browser/device boundaries.
- SSE framing, UTF-8, JSON answers, cancellation, timeouts, explicit errors, origin/Host
  guards, no provider fallback, Norwegian locale and build-env isolation are covered.
- Shell syntax and Node module syntax checks passed.
- Full dependency install, Vite build/lint, live MMIR chat and physical Mac audio were
  **not verified in that environment** because network DNS and target-device access were
  unavailable. These remain acceptance gates, not passed checks.

Run `npm run test:mmir`, `npm run build`, `npm run lint`, the explicit live doctor check,
and the real voice checks above before calling the Mac installation complete.
