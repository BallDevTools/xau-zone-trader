const MIN = 60_000;

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * MIN);

/** Trading-day key (YYYY-MM-DD, UTC) with the day rolling over at `resetUtcHour`. */
export function dayKey(d: Date, resetUtcHour = 0): string {
  return new Date(d.getTime() - resetUtcHour * 60 * MIN).toISOString().slice(0, 10);
}

/** Start of the bucket of `minutes` length that contains `d` (UTC aligned). */
export function bucketStart(d: Date, minutes: number): Date {
  const ms = minutes * MIN;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

/**
 * Minutes from `now` until the next weekly close (ISO weekday 1=Mon..7=Sun, "HH:MM" UTC).
 * Returns a value in (0, 7 days]; once the close has passed it points to next week's close.
 */
export function minutesUntilWeekly(now: Date, weekday: number, timeUtc: string): number {
  const [hh, mm] = timeUtc.split(':').map(Number) as [number, number];
  const isoToday = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm));
  target.setUTCDate(target.getUTCDate() + (weekday - isoToday));
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 7);
  return (target.getTime() - now.getTime()) / MIN;
}

/** "HH:MM" on a YYYY-MM-DD date, both UTC. */
export function utcAt(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00Z`);
}
