# Jarvis – lokalt oppsett på Mac

Denne veiledningen gjelder den selvstendige kopien `inkognitroz/jarvis`. Ingen integrasjon med andre prosjekter, fjernstyring, autostart eller GitHub Actions-jobb er lagt til.

## Status ved kontroll 18. september 2026

Før denne veiledningen ble lagt til, rapporterte GitHub at `inkognitroz/jarvis:main` var identisk med `adewaskar/jarvis:main`, på commit `1c4016afdf86f7043efc6882ceffef84ad0d8783`.

Opprettelsen av GitHub-kopien er bekreftet. Lokal installasjon, bygg, innlogging, mikrofon og ende-til-ende-svar på Mac er **ikke testet**. Denne dokumentasjonen er ikke en bekreftelse på at appen kjører.

## Før installasjon

- Bruk en støttet Node.js-versjon. Node 22 må være minst 22.12. Vite dokumenterer også støtte fra Node 20.19; repoets generelle krav `>=20` er derfor ikke presist nok alene. Kontroller med `node --version` og `npm --version`.
- Bruk Chrome eller Edge i et vanlig nettleservindu for stemmefunksjonen, slik prosjektets README beskriver.
- ElevenLabs er valgfritt. Ikke legg inn eller kjøp en nøkkel for å kontrollere at prosjektet kan installeres og bygges.
- Modelltilgang må avklares separat. README hevder at eksisterende Claude Code-innlogging kan gjenbrukes. Anthropic dokumenterer API-nøkkel som SDK-oppsett og begrenser tredjepartsprodukter som tilbyr claude.ai-innlogging eller abonnementets kvoter uten forhåndsgodkjenning. Det er ikke verifisert at README-påstanden gjelder din konkrete bruk. Ikke kjøp et abonnement på grunnlag av README alene.

## 1. Installer og kontroller prosjektet

Kjør dette i Terminal på Mac-en. Kommandoene stopper dersom målmappen allerede finnes, slik at en eksisterende installasjon ikke overskrives. Bruk den eksisterende klonen separat dersom den allerede er opprettet.

```bash
(
  set -eu
  mkdir -p "$HOME/Projects"
  cd "$HOME/Projects"
  if [ -e jarvis ]; then
    printf '%s\n' 'Mappen ~/Projects/jarvis finnes allerede. Ingen filer er endret.'
    exit 1
  fi
  git clone https://github.com/inkognitroz/jarvis.git jarvis
  cd jarvis
  npm ci
  npm run build
  npm run lint
)
```

`npm ci` installerer fra prosjektets låsefil. Installasjonen krever internett og kan kjøre avhengighetenes installasjonsskript. Bygg og lint starter ikke Jarvis-agenten og tester ikke modelltilgangen. Ved feil: stopp og undersøk feilen; ikke slett låsefilen eller kjør `npm audit fix --force` som en automatisk løsning.

## 2. Kontroller tilganger før agenten startes

Les `bridge/server.mjs`, spesielt `configuredServers()` og `decideTool()`.

**Viktig:** Bridge-koden henter automatisk MCP-konfigurasjon fra `~/.claude.json`, både globale servere og servere knyttet til hjemmemappen. Et separat Git-repository er derfor ikke i seg selv isolasjon fra eksisterende verktøy, kontoer eller filer. `JARVIS_ALLOW_WRITES=0` slår av prosjektets tillatelse til skrivehandlinger, men er ikke en operativsystem-sandkasse og deaktiverer ikke all lesing, nettverksbruk eller generering som kan koste penger.

Ikke start bridge-prosessen med en eksisterende personlig MCP-konfigurasjon før verktøyene og tillatelsene er gjennomgått. Førstegangsoppsett uten arvede integrasjoner krever en eksplisitt isolert konfigurasjon eller en kontrollert kodeendring; denne veiledningen legger ikke til en slik endring.

API-nøkler skal aldri legges i Git, en issue eller en chat. Ikke bruk `VITE_ANTHROPIC_API_KEY` for en hemmelig backend-nøkkel: `VITE_*`-verdier kan havne i nettleserkoden. Bruk godkjent server-side autentisering og avklar eventuell betaling før en modellforespørsel sendes.

## 3. Oppstart etter at autentisering og verktøytilganger er avklart

Prosjektet bruker som standard modellnavnet `claude-opus-5`. Kontroller at valgt konto faktisk har tilgang til modellen; `JARVIS_MODEL` kan settes til et modellnavn kontoen støtter. Tilgangen er ikke testet her.

Kontroller at portene 5173 og 8787 er ledige før oppstart. Ikke avslutt andre prosesser for å frigjøre dem. En portendring må samordnes mellom frontend, bridge, tillatte origins og nettleserens sikkerhetspolicy.

```bash
cd "$HOME/Projects/jarvis"
JARVIS_ALLOW_WRITES=0 JARVIS_EFFORT=medium npm start
```

Dette starter både bridge og nettlesergrensesnittet som prosesser i terminalen. Åpne adressen Vite skriver ut, normalt `http://localhost:5173`, i Chrome eller Edge. Klikk **INITIALISE**, godkjenn mikrofonen og prøv «Hey Jarvis». **Ctrl-C** stopper oppstartsskriptets prosesser.

Ikke bruk `--writes` eller `npm run bridge:writes` under første utprøving. Ikke eksponer utviklingsserveren eller bridge-porten på internett.

## Hva som må bekreftes før oppsettet kalles ferdig

1. `npm ci`, `npm run build` og `npm run lint` er gjennomført med kjente resultater på målmaskinen.
2. Autentisering, modelltilgang og betalingsmåte er avklart.
3. De verktøyene bridge faktisk får tilgang til, er kontrollert.
4. Grensesnitt, mikrofon, et faktisk modellsvar og lydavspilling er testet i nettleseren.

## Kilder kontrollert 18. september 2026

- [Prosjektets README](README.md)
- [Pakker og kommandoer](package.json)
- [Oppstartsskript](scripts/start.mjs)
- [Bridge og tillatelseslogikk](bridge/server.mjs)
- [Vite: Node.js-krav](https://vite.dev/guide/)
- [Anthropic: Agent SDK og autentisering](https://code.claude.com/docs/en/agent-sdk/overview)
