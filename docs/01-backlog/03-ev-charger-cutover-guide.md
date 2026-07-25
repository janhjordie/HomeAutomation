---
title: "EV Charger — Cutover guide"
status: Active
last_updated: "24-07-2026 22:00"
owner: "@janhjordie"
backlog: EVC-013, EVC-014
---

# Cutover: HomeyScript → App

## EVC-013 — Parallel validation (7 dage)

### Dag 1–7 checkliste

- [ ] App kører med `mirror_logic_variables: true`
- [ ] HomeyScript cron-Flow kører stadig (sammenligning)
- [ ] `validation_enabled: true` i app settings
- [ ] Tjek logs for `[EVC-013] Mismatch` — skal være sjælden
- [ ] Efter 7 dage: `GET /api/app/com.janhjordie.evchargeplanner/validationSummary`
  - Mål: `matchRate >= 0.95` (95%)

### Hvad logges

Appen logger hver evaluering med:
- `app_charge_now`
- `script_charge_now` (null under parallel — sammenlign manuelt via logs)
- `match`

Under parallel kørsel: sammenlign `charge_now` i Homey Logic med app device capability.

## EVC-014 — Cutover checkliste

### Før cutover

- [ ] EVC-013 bestået (≥95% match eller PO sign-off)
- [ ] To EV Planner devices parret og navngivet
- [ ] Flows dokumenteret i [02-ev-charger-migration-guide.md](./02-ev-charger-migration-guide.md)

### Cutover (gør i denne rækkefølge)

1. **Opdater Easee/lader-Flows**
   - Skift trigger fra `Logic charge_now` til `[EV Bil X] charge_now turned on`
   - Eller behold Logic hvis mirror stadig er aktiv

2. **Deaktiver HomeyScript cron-Flow**
   - Slå Flow fra der kører `EVCharger.js` hvert 15. minut
   - Appen overtager scheduling

3. **Verificer 3 dage**
   - [ ] Bil lader i billige perioder
   - [ ] `force_charge` virker om dagen
   - [ ] `one_shot` virker med deadline
   - [ ] Notifikation ved API-fejl

4. **Oprydning (valgfrit efter 3 dage)**
   - [ ] Sæt `mirror_logic_variables: false`
   - [ ] Fjern ubrugte Logic-variabler (charge_now, charge_message, forceCharge, ...)
   - [ ] Marker `Homey/EVCharger.js` som deprecated (allerede gjort)

### Rollback ved problemer

1. Genaktiver HomeyScript cron-Flow
2. Slå app fra midlertidigt
3. Logic-variabler har sidste kendte værdi fra mirror

## Efter cutover

| Komponent | Status |
|-----------|--------|
| `Homey/com.janhjordie.evchargeplanner/` | **Aktiv** |
| `Homey/EVCharger.js` | **Deprecated** — behold som reference |
| HomeyScript cron-Flow | **Deaktiveret** |
| Logic-variabler | **Valgfri** — kan fjernes når Flows bruger capabilities |

## PO sign-off

| Dato | Resultat | Noter |
|------|----------|-------|
| | | Udfyldes efter 3 dages drift |
