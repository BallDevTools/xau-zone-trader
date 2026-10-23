import { BrokerProfileSchema, RiskConfigSchema } from '../src/config/schemas';
import type { BrokerProfile, RiskConfig } from '../src/config/schemas';
import type { GatewayInput } from '../src/risk/Gateway';
import type { Quote } from '../src/types';
import profileJson from '../config/broker_profile.json';
import riskJson from '../config/risk.json';

export const profile: BrokerProfile = BrokerProfileSchema.parse(profileJson);
export const risk: RiskConfig = RiskConfigSchema.parse(riskJson);

/** Wednesday 2026-10-21 10:00 UTC — far from the weekend close. */
export const WED = new Date('2026-10-21T10:00:00Z');

export const quote = (bid: number, spread = 0.3, time = WED): Quote => ({
  time,
  bid,
  ask: Math.round((bid + spread) * 1000) / 1000,
});

export function gatewayInput(over: Partial<GatewayInput> = {}): GatewayInput {
  const q = over.quote ?? quote(4174);
  return {
    now: q.time,
    quote: q,
    account: { balance: 100, equity: 100, freeMargin: 100, leverage: 3000 },
    positions: [],
    day: { trades: 0, losses: 0, lossUsd: 0 },
    lastSlAt: null,
    killed: false,
    news: { available: true, windows: [] },
    intent: { side: 'BUY', sl: 4165, tp: 4190, zoneId: 'B1', planDate: '2026-10-21', strategy: 'zone' },
    ...over,
  };
}
