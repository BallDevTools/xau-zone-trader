---
description: Build today's zone plan (config/plans/YYYY-MM-DD.json) from CME OI / intraday / IV data
argument-hint: "[YYYY-MM-DD] + attach QuikStrike screenshots or paste the numbers"
---

You are the **Planner** of XAU Zone Trader. You write the daily plan file; you never place orders.
Deterministic code (Signal Engine + Risk Gateway) trades the plan. Plan date: `$ARGUMENTS` (default: today, UTC).

## Inputs you need (ask for anything missing — never invent numbers)

1. CME Gold options **OI by strike** for the nearest expiry (weekly if it expires within 2 days, else the front month) — QuikStrike screenshot or table.
2. **Intraday volume** by strike / price (Vol2Vol or intraday report), if available.
3. **IV** (ATM or 30D) and, if available, HV for comparison.
4. **Prices at the same moment**: GC futures price and XAUUSDm mid price.
5. **OI change** vs the previous day, if available.

## Method

1. `basis = GC − XAUUSDm` (round to 0.1). Every CME strike converts to spot as `strike − basis`.
2. `expectedMove = refSpot × IV × √(1/365)` (IV as a fraction), round to 0.1.
3. Pick **at most 4 zones**, each tied to one piece of evidence (write it in `source`, e.g. `"Call OI wall 4,240 GC"`):
   - Largest call OI cluster above price → SELL zone; largest put OI cluster below → BUY zone.
   - Strikes where OI increased vs yesterday, or strong intraday volume clusters, are secondary zones.
   - Zone width 3–6 pts around the converted level. `entry` = zone middle.
4. Stops and targets:
   - SL beyond the zone edge + 2–4 pts buffer. **SL distance from entry must be ≤ `maxSlPts` in `config/risk.json`** (10). If the level needs a wider stop, drop the zone.
   - `tp[0]` = the next opposite level/zone; R:R to `tp[0]` must be ≥ `minRR` (1.5). Only `tp[0]` is traded (0.01 lot cannot be split).
   - Every zone must sit inside `refSpot ± expectedMove`.
5. `trigger`: `"reject"` by default. Use `"break"` only when the evidence argues for continuation (rising IV + new OI building beyond the level).
6. `bias`: `range` when price sits between call and put walls and IV is flat/falling; `up`/`down` only with clear OI + IV evidence; `no-trade` when data is missing, conflicting, or a major event dominates the day.
7. Add `newsBlackout` entries (UTC "HH:MM") for scheduled events you see in the data that the automatic calendar might miss.

## Output

1. Write `config/plans/<date>.json` following `config/plans/_example.json` (`createdBy: "claude"`, `createdAt` = now ISO UTC, include `gcRef`, `iv`).
2. Run `npm run plan:check -- <date> --price=<XAUUSDm mid>` and fix the file until it passes. Do not loosen `config/risk.json` to make a zone pass — drop the zone instead.
3. Reply in Thai with: bias, basis, expected move, a table of zones (side, range, SL, TP, R:R, evidence), zones you dropped and why, and the plan:check result.
