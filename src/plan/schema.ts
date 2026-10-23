import { z } from 'zod';

const hhmm = z.string().regex(/^\d\d:\d\d$/, 'expected "HH:MM" (UTC)');

export const ZoneSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/, 'e.g. "B1", "S2"'),
  side: z.enum(['BUY', 'SELL']),
  low: z.number().positive(),
  high: z.number().positive(),
  entry: z.number().positive(),
  sl: z.number().positive(),
  /** tp[0] is the order TP (0.01 lot cannot be split); later targets are informational. */
  tp: z.array(z.number().positive()).min(1).max(3),
  trigger: z.enum(['reject', 'break']),
  source: z.string().min(1),
  invalidIfCloseAbove: z.number().positive().optional(),
  invalidIfCloseBelow: z.number().positive().optional(),
});
export type Zone = z.infer<typeof ZoneSchema>;

export const PlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdBy: z.string().default('manual'),
  createdAt: z.string().optional(),
  bias: z.enum(['range', 'up', 'down', 'no-trade']),
  /** XAUUSDm price when the plan was written. */
  refSpot: z.number().positive(),
  /** GC futures price at the same moment (optional, enables the basis check). */
  gcRef: z.number().positive().optional(),
  /** GC − spot, used to convert CME strikes to spot levels. */
  basis: z.number(),
  /** Expected daily move in pts (from IV). Zones must sit inside refSpot ± expectedMove. */
  expectedMove: z.number().positive(),
  iv: z.number().positive().optional(),
  newsBlackout: z.array(z.object({ start: hhmm, end: hhmm, title: z.string() })).default([]),
  zones: z.array(ZoneSchema).max(8),
  notes: z.string().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;
