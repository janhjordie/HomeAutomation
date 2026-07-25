---
title: "EV Charger — Migration HomeyScript til App"
status: Active
last_updated: "24-07-2026 22:00"
owner: "@janhjordie"
backlog: EVC-012
---

# Migration: HomeyScript → EV Charge Planner App

## Oversigt

Denne guide beskriver overgangen fra `Homey/EVCharger.js` (HomeyScript) til appen `Homey/com.janhjordie.evchargeplanner`.

## Forudsætninger

- Homey Pro 13.3.0
- Homey CLI installeret (`npm install -g homey`)
- Strømligning API-nøgle i **app-indstillinger** (primær) eller Logic-variabel `StromligningApiKey` (migration)

## Trin 1 — Installer appen

```bash
cd Homey/com.janhjordie.evchargeplanner
homey app run
```

Åbn derefter **Apps → EV Charge Planner → Indstillinger** og indsæt Strømligning API-nøgle.

## Trin 2 — Par devices

1. Gå til **Homey → Enheder → +** (Tilføj enhed)
2. Scroll ned til **Apps** / **Homey apps**
3. Vælg **EV Charge Planner** / **EV Ladeplan**
4. Vælg **EV Ladeplan** i listen og tryk **Tilføj**
5. Par **to** enheder hvis I har to biler
6. Omdøb dem fx "EV Bil 1" og "EV Bil 2"
7. Sæt `charge_hours` per device (standard 3)

> **Bemærk:** App-siden (Configure / Restart) har ikke en "Tilføj enhed"-knap. Enheder tilføjes via Enheder → +.

## Trin 3 — Aktivér parallel kørsel (EVC-013)

I app-indstillinger:

- **Mirror to Logic variables**: `true` (standard)
- **Log validation comparisons**: `true` (standard)

Behold HomeyScript-Flow aktiv i 7 dage. Appen skriver til de samme Logic-variabler (`charge_now`, `charge_message`) så eksisterende Flows virker.

## Capability-mapping

| HomeyScript / Logic | App capability / setting |
|---------------------|--------------------------|
| `charge_now` | `charge_now` |
| `charge_message` | `charge_message` |
| (ny) | `charge_schedule` |
| `forceCharge` | `force_charge` |
| `ChargeHours` | device setting `charge_hours` |
| `oneShotCharge` | device setting `one_shot_enabled` |
| `oneShotChargeHours` | device setting `one_shot_charge_hours` |
| `oneShotReadyBy` | device setting `one_shot_ready_by` |

## Flow-ændringer (efter cutover)

### Før (HomeyScript)

```
When: Cron hvert 15. min
Then: Kør HomeyScript EVCharger.js
When: Logic charge_now = true
Then: Start opladning
```

### Efter (App)

```
When: [EV Bil 1] charge_now turned on
Then: Start opladning

# Eller behold Logic charge_now hvis mirror er aktiv
```

### Nye Flow-muligheder

| Flow card | Brug |
|-----------|------|
| Charge plan updated | Log/notifikation med plan |
| Start force charge | Manuel dagopladning |
| Start one-shot charge | Rejse-opladning |
| Recalculate charge plan now | Efter settings-ændring |

## Rollback

1. Deaktiver app-scheduler: sluk appen i Homey
2. Genaktiver HomeyScript cron-Flow
3. Sæt `mirror_logic_variables` til `false` i app settings

## Validering

Se [02-ev-charger-cutover-guide.md](./02-ev-charger-cutover-guide.md) for cutover-checkliste.

Kør smoke test lokalt:

```bash
cd Homey/com.janhjordie.evchargeplanner
npm run smoke
```

Tjek valideringslog via app API efter 7 dage parallel kørsel:

```
GET /api/app/com.janhjordie.evchargeplanner/validationSummary
```
