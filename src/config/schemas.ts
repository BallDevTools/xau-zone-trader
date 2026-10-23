import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const BrokerProfileSchema = z.object({
  broker: z.string(),
  account: z.string(),
  symbol: z.string().min(1),
  contractSize: z.number().positive(),
  minLot: z.number().positive(),
  lotStep: z.number().positive(),
  maxLot: z.number().positive(),
  digits: z.number().int().min(0),
  point: z.number().positive(),
  leverage: z.number().positive(),
  commissionPerLot: z.number().min(0),
  marginCall: z.number().min(0),
  stopOut: z.number().min(0),
  stopsLevelPoints: z.number().int().min(0).nullable(),
  swapLong: z.number().nullable(),
  swapShort: z.number().nullable(),
  serverUtcOffsetHours: z.number(),
  defaultSpread: z.number().positive(),
  slSlippage: z.number().min(0),
  newsMarginLeverage: z.number().positive(),
  weekendClose: z.object({
    weekday: z.number().int().min(1).max(7),
    timeUtc: z.string().regex(/^\d\d:\d\d$/),
  }),
  dayResetUtcHour: z.number().int().min(0).max(23),
});
export type BrokerProfile = z.infer<typeof BrokerProfileSchema>;

export const RiskConfigSchema = z
  .object({
    fixedLot: z.number().positive(),
    maxLot: z.number().positive(),
    maxSlPts: z.number().positive(),
    minRR: z.number().positive(),
    dailyLossUsd: z.number().positive(),
    dailyMaxLosses: z.number().int().positive(),
    maxTradesPerDay: z.number().int().positive(),
    equityFloorUsd: z.number().min(0),
    maxOpenPositions: z.number().int().positive(),
    allowAddToLoser: z.literal(false),
    slCooldownMin: z.number().min(0),
    maxSpreadPts: z.number().positive(),
    newsBlackoutBeforeMin: z.number().min(0),
    newsBlackoutAfterMin: z.number().min(0),
    noNewTradesBeforeWeekendMin: z.number().min(0),
    flatBeforeWeekendMin: z.number().min(0),
    shadowStartBalance: z.number().positive(),
    goLive: z.object({
      minSetups: z.number().int().positive(),
      minWinRate: z.number().min(0).max(1),
      minExpectancyR: z.number(),
      maxDrawdownR: z.number().positive(),
    }),
  })
  .refine((r) => r.fixedLot <= r.maxLot, { message: 'fixedLot must be ≤ maxLot' })
  .refine((r) => r.noNewTradesBeforeWeekendMin >= r.flatBeforeWeekendMin, {
    message: 'noNewTradesBeforeWeekendMin must be ≥ flatBeforeWeekendMin',
  });
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export function loadJson<T>(path: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read ${path}: ${(err as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid ${path}:\n${issues}`);
  }
  return parsed.data;
}

export const loadBrokerProfile = (path = 'config/broker_profile.json') => loadJson(path, BrokerProfileSchema);
export const loadRiskConfig = (path = 'config/risk.json') => loadJson(path, RiskConfigSchema);
