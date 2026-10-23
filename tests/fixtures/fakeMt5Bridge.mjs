// Speaks the bridge/mt5_bridge.py protocol without MT5. Server time = UTC+2.
// FAKE_MODE=die exits with an error before "ready".
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
if (process.env.FAKE_MODE === 'die') {
  out({ type: 'error', message: 'mt5.initialize failed: (-10003, "IPC initialize failed")' });
  process.exit(3);
}
const H = 3_600_000;
const srv = (iso) => Date.parse(iso) + 2 * H;
out({
  type: 'ready',
  spec: { symbol: 'XAUUSDm', contractSize: 100, minVolume: 0.01, maxVolume: 200, volumeStep: 0.01, digits: 3, point: 0.001, stopsLevel: 0, leverage: 3000 },
  account: { login: 1, server: 'Exness-MT5Trial', company: 'Exness', tradeMode: 0 },
});
createInterface({ input: process.stdin }).on('line', (l) => {
  const req = JSON.parse(l);
  if (req.cmd === 'history') out({ type: 'history', id: req.id, bars: [{ t: srv('2026-10-21T10:00:00Z') / 1000, o: 4170, h: 4175, l: 4168, c: 4172 }] });
});
setTimeout(() => {
  out({ type: 'status', connected: true });
  for (const [iso, bid] of [['10:00:01', 4170], ['10:07:00', 4175], ['10:14:59', 4168], ['10:15:00', 4169]])
    out({ type: 'tick', msc: srv(`2026-10-21T${iso}Z`), bid, ask: bid + 0.3 });
}, 150);
