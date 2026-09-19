/**
 * US equity session clock. The single most important input nobody else prices:
 * 63% of tokenized equity volume trades while the underlying market is shut.
 * All reasoning in UTC; NYSE regular session is 13:30-20:00 UTC during EDT.
 */

const HOLIDAYS_2026 = new Set([
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25'
]);

export function sessionState(date = new Date()) {
  const d = new Date(date);
  const day = d.getUTCDay();               // 0 Sun .. 6 Sat
  const iso = d.toISOString().slice(0, 10);
  if (day === 0 || day === 6) return 'weekend';
  if (HOLIDAYS_2026.has(iso)) return 'holiday';

  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const open = 13 * 60 + 30;   // 13:30 UTC = 09:30 ET (EDT)
  const close = 20 * 60;       // 20:00 UTC = 16:00 ET (EDT)
  return (mins >= open && mins < close) ? 'regular' : 'afterHours';
}

/** Hours until the underlying market reopens - drives how long we are exposed. */
export function hoursToReopen(date = new Date()) {
  const d = new Date(date);
  for (let h = 0; h < 96; h++) {
    const probe = new Date(d.getTime() + h * 3600_000);
    if (sessionState(probe) === 'regular') return h;
  }
  return 96;
}
