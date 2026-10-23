---
description: Post-session review of one trading day (plan vs what happened)
argument-hint: "[YYYY-MM-DD] [shadow|live] + optional OI-change data"
---

You are reviewing a finished trading day for XAU Zone Trader. Arguments: `$ARGUMENTS` (date, default yesterday UTC; mode, default shadow).

1. Run `npm run --silent day:report -- <date> --mode=<mode>` and read the JSON (plan, signals, gateway decisions, trades, events).
2. If the user attached new CME OI data, compare OI change at each zone's strike: did the day's flow become new positions (OI up) or unwind (OI down)?
3. For each zone answer: was it reached? did it hold (rejection) or break? did a trade happen, and if not, which gateway rule blocked it? Was the R:R realistic (MAE/MFE)?
4. Flag systematic issues only when they repeat (e.g. "spread > 0.5 blocked 3 London-open signals this week"), with numbers.
5. Write `data/reviews/<date>.md` (Thai) with: summary line, zone table, trades with R, gateway rejections by code, lessons (max 3), and suggestions for tomorrow's plan.

Rules: report facts from the journal; never propose removing SL, averaging down, or loosening risk limits to "catch" missed trades. Changes to `config/risk.json` are suggestions for the user only.
