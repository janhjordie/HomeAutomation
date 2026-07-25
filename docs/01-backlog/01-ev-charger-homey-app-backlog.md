---
title: "EV Charger — Homey Pro App backlog"
status: Active
last_updated: "24-07-2026 22:00"
owner: "@janhjordie"
stream: ev-charger-homey-app
id_namespace: EVC
target_homey_version: "13.3.0"
source: "docs/01-backlog/00-ev-charger-homey-app-analysis.md"
---

# Stream backlog — EV Charger Homey Pro App

**Analyse:** [00-ev-charger-homey-app-analysis.md](./00-ev-charger-homey-app-analysis.md)  
**Migration:** [02-ev-charger-migration-guide.md](./02-ev-charger-migration-guide.md)  
**Cutover:** [03-ev-charger-cutover-guide.md](./03-ev-charger-cutover-guide.md)  
**App:** `Homey/com.janhjordie.evchargeplanner/`  
**Kilde-script:** `Homey/EVCharger.js` (deprecated)

---

## Status Rollup

| Area | Not started | In progress | Partially done | Blocked | Active total | Source |
|------|-------------|-------------|----------------|---------|--------------|--------|
| Scaffold & lib | 0 | 0 | 0 | 0 | 0 | EVC-002, EVC-003 |
| Price & settings | 0 | 0 | 0 | 0 | 0 | EVC-004, EVC-005 |
| Device & scheduler | 0 | 0 | 0 | 0 | 0 | EVC-006, EVC-007 |
| Flow cards | 0 | 0 | 0 | 0 | 0 | EVC-008–011 |
| Migration & cutover | 0 | 0 | 2 | 0 | 2 | EVC-012–014 |
| **Total** | **0** | **0** | **2** | **0** | **2** | |

---

## Now / Next / Later

| Lane | ID | Task |
|------|-----|------|
| **Now** | EVC-013 | Parallel validation på Homey Pro (7 dage) |
| **Now** | EVC-014 | Cutover efter validation (PO sign-off) |
| **Later** | EVC-015 | HA webhook endpoint i app |

---

## Priority And Dependency Order

```
EVC-001 → EVC-014 (kode done)
  → EVC-013 (runtime validation på Homey — PO)
  → EVC-014 (cutover — PO)
```

---

## Open Queue

| ID | P | Status | Initiative | Epic | Parent | Depends on | Task | DoD (verifiable) | Evidence | Source |
|----|---|--------|------------|------|--------|------------|------|------------------|----------|--------|
| EVC-001 | P1 | done | EV Homey App | Analyse | — | — | Analyse og backlog for Homey Pro app-migration | Analyse-dokument + stream backlog med stable IDs, rollup, Now/Next/Later; Homey 13.3.0 krav dokumenteret | `docs/01-backlog/00-ev-charger-homey-app-analysis.md` | user-request |
| EVC-002 | P1 | done | EV Homey App | Scaffold | — | EVC-001 | Opret Homey app-projekt `com.janhjordie.evchargeplanner` | App-struktur med sdk:3, compatibility >=13.0.0, platforms local | `Homey/com.janhjordie.evchargeplanner/`, `app.json` | analysis |
| EVC-003 | P1 | done | EV Homey App | Lib extract | — | EVC-002 | Extract ren JS fra EVCharger.js til `lib/` | Pure functions i lib/ uden Homey.*; require() fra Node | `npm run smoke` passed | `Homey/EVCharger.js` |
| EVC-004 | P1 | done | EV Homey App | Price fetch | — | EVC-003 | Port EDS + Strømligning fetch med fallback | fetchPrices() med EDS prioritet og 1h→15m fallback | Live fetch: `energidataservice` i smoke test | `lib/price/` |
| EVC-005 | P2 | done | EV Homey App | Settings | — | EVC-002 | App settings: price area, threshold, kW, notification user | settings/index.html + locales da/en | `settings/index.html`, `locales/` | analysis |
| EVC-006 | P1 | done | EV Homey App | Virtual device | — | EVC-003–005 | Virtuelt EV Planner driver med capabilities | Driver ev_planner med charge_now, charge_message, charge_schedule, force_charge | `drivers/ev_planner/` | analysis D1 |
| EVC-007 | P1 | done | EV Homey App | Scheduler | — | EVC-006 | 15-min evaluerings-scheduler i app | setInterval(15 min) i app.onInit + evaluate on init | `app.js` EVALUATION_INTERVAL_MS | SDK v3 |
| EVC-008 | P2 | done | EV Homey App | Flow triggers | — | EVC-007 | Flow triggers: plan_updated, price_api_error | driver.flow.compose.json + device trigger calls | `driver.flow.compose.json`, `device.js` | analysis |
| EVC-009 | P2 | done | EV Homey App | Flow conditions | — | EVC-007 | Flow conditions: should_charge, force_charge_active, one_shot_active | Conditions registreret i driver.js | `driver.js` | analysis |
| EVC-010 | P2 | done | EV Homey App | Flow actions | — | EVC-006 | Flow actions: force on/off, one-shot start/cancel, recalculate | Actions registreret i driver.js | `driver.js` | `EVCharger.js` |
| EVC-011 | P3 | done | EV Homey App | Logic compat | — | EVC-007 | Midlertidig spejling til Logic-variabler | LogicCompat klasse mirror/sync | `lib/logicCompat.js`, `device.js` | analysis D2 |
| EVC-012 | P2 | done | EV Homey App | Migration guide | — | EVC-008 | Dokumentér migration HomeyScript → App | Step-by-step guide med capability-mapping | `docs/01-backlog/02-ev-charger-migration-guide.md` | cutover prep |
| EVC-013 | P1 | partial | EV Homey App | Validation | — | EVC-007, EVC-011 | Parallel validation mod HomeyScript i 7 dage | ValidationLogger + app API; PO kører 7 dage på Homey | `lib/validationLogger.js`, `api.js` — **afventer runtime på Homey** | analysis |
| EVC-014 | P1 | partial | EV Homey App | Cutover | — | EVC-013 | Deaktiver HomeyScript; opdater Flows til device capabilities | Cutover guide + EVCharger.js deprecated — **afventer PO cutover** | `docs/01-backlog/03-ev-charger-cutover-guide.md`, `EVCharger.js` deprecated | EVC-013 |

---

## Ready To Start Gate

- [x] EVC-001–012: Implementeret
- [ ] EVC-013: Kør app på Homey Pro 13.3.0 med parallel HomeyScript i 7 dage
- [ ] EVC-014: PO sign-off efter EVC-013 + 3 dages drift

---

## Done Verification Gate

- [x] EVC-001–012: Kode + docs leveret
- [ ] EVC-013: matchRate >= 95% eller PO sign-off
- [ ] EVC-014: Cron HomeyScript slået fra, Flows opdateret, 3 dages drift OK

---

## Blockers

| ID | Owner | Blocker | Action | Unblock target |
|----|-------|---------|--------|----------------|
| — | — | Ingen aktive blockers | Installer app på Homey: `homey app run` | EVC-013 |

---

## Decision Log

| ID | Decision | Affects | Status |
|----|----------|---------|--------|
| DEC-EVC-001 | Virtuelt device per lader (2 biler) | EVC-006, EVC-014 | **accepted** |
| DEC-EVC-002 | Privat app (`homey app install`), ikke App Store | EVC-002 | **accepted** |
| DEC-EVC-003 | Logic-spejling under parallel run (EVC-011) | EVC-013, EVC-014 | **accepted** |
| DEC-EVC-004 | JavaScript (ikke TypeScript) i v1 | EVC-002, EVC-003 | **accepted** |
| DEC-EVC-005 | `platforms: ["local"]` only — ingen Homey Cloud | EVC-002 | **accepted** |

---

## Review Notes

- Kode EVC-002–012 er implementeret; smoke test + live EDS fetch passerer lokalt
- Homey CLI ikke installeret lokalt — `homey app run` skal køres på dev-maskine med CLI
- EVC-013/014 kræver runtime på Homey Pro (PO-handling)

---

## Parked / Later

| ID | P | Status | Task | Note |
|----|---|--------|------|------|
| EVC-015 | P3 | parked | HA webhook endpoint i app (`api.js`) | Erstatter `SendEVWebhook.js` |
| EVC-016 | P3 | parked | Insights: spotpris og besparelse | Kræver capability history |
| EVC-017 | P3 | parked | TypeScript migration | Efter v1 stabil |
