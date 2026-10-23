# CLAUDE.md — XAU Zone Trader

Priority: **correctness → risk management → performance**. Never suggest Martingale, averaging down, or removing stop losses.

## Context
- Broker Exness **Standard**, symbol **`XAUUSDm`** (m suffix), contract 100, min lot 0.01, leverage 1:3000, stop-out 0%.
- Account: **$100**. Lot is **fixed 0.01**; leverage never changes risk, only margin.
- 1 pt = $1 of price → 0.01 lot loses $1 per pt. Max SL 10 pts ≈ $10 ≈ 10% of the account per trade (user accepted this risk).

## Architecture (see README)
`src/plan` (zod schema + validator) → `src/signal/Engine.ts` (M15 reject / break-retest) → `src/risk/Gateway.ts` (pure, every order) → `src/broker` (ShadowBroker | MetaApiExecution) → `src/journal/Journal.ts` (SQLite) → `src/dashboard` + `web/`.
`src/core/TradingCore.ts` wires them; backtest, replay, shadow and live run the same core.

## Rules for changes
- Every order goes through `Gateway.decide`. Never add an order path that bypasses it.
- Gateway rules each need a test in `tests/gateway.test.ts`. Run `npm run check` before calling work done.
- Cooldown after SL is **global** (both sides). No adding to losing positions. News calendar failure = no trading.
- Do not loosen `config/risk.json` to make a plan or a trade pass; drop the zone instead. Changes to risk limits are the user's decision.
- Live mode is gated on shadow stats (`goLive` in risk.json) and `--confirm=real-money`. Do not add bypass flags.
- Be skeptical of backtest WR > 70% or tiny samples; groups with n < 20 are not conclusions.
- Planner (Claude) only writes `config/plans/*.json` via `/plan`; it never places orders.
