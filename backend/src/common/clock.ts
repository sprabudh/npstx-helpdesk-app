/**
 * Application clock. Always the real system clock, so tickets, comments, events, notifications
 * and SLA states all use real dates. (Kept as a single indirection so "now" has one definition.)
 */
class Clock {
  nowMs(): number {
    return Date.now();
  }
  now(): Date {
    return new Date();
  }
}
export const clock = new Clock();

/** Artifact timestamps are IST local strings "YYYY-MM-DDTHH:mm". */
export const fromIst = (s: string | null | undefined): Date | null =>
  s ? new Date(Date.parse(s.length === 16 ? `${s}:00+05:30` : s)) : null;

const IST_OFFSET = 19800000;
const p2 = (n: number) => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "04 Nov, 17:05" in IST, the artifact's date format (used in server-built messages). */
export function fdt(d: Date | null | undefined): string {
  if (!d) return '—';
  const x = new Date(d.getTime() + IST_OFFSET);
  return `${p2(x.getUTCDate())} ${MON[x.getUTCMonth()]}, ${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`;
}
export function istDate(d: Date): string {
  const x = new Date(d.getTime() + IST_OFFSET);
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`;
}
export function dur(ms: number): string {
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  if (d) return `${d}d ${h % 24}h`;
  const m = Math.floor(ms / 60000) % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
export const fmtH = (h: number) =>
  h < 1 ? `${Math.round(h * 60)} min` : h < 24 ? `${h} h` : `${+(h / 24).toFixed(1)} day${h > 24 ? 's' : ''}`;
