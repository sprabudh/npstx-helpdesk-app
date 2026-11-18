/** Dates shown exactly as in the artifact: "04 Nov" and "04 Nov, 17:05", in the configured time zone (IST). */
let TZ = 'Asia/Kolkata';
export const setTimeZone = (tz: string) => (TZ = tz);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parts(d: string | Date) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(typeof d === 'string' ? new Date(d) : d)) o[p.type] = p.value;
  return o;
}
export const fd = (d?: string | Date | null) => (d ? `${parts(d).day} ${MON[Number(parts(d).month) - 1]}` : '—');
export const fdt = (d?: string | Date | null) => {
  if (!d) return '—';
  const p = parts(d);
  return `${p.day} ${MON[Number(p.month) - 1]}, ${p.hour}:${p.minute}`;
};
/** YYYY-MM-DD in the display time zone. */
export const isoDate = (d: string | Date) => {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
};
export function dur(ms: number) {
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  if (d) return `${d}d ${h % 24}h`;
  const m = Math.floor(ms / 60000) % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
export const fmtH = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 24 ? `${h} h` : `${+(h / 24).toFixed(1)} day${h > 24 ? 's' : ''}`);
export const ini = (name: string, isQueue = false) => (isQueue ? 'Q' : name.split(' ').map((w) => w[0]).join('').slice(0, 2));
export const sizeLabel = (b: number) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
export const HDL: Record<string, string> = { HR: 'HR', LND: 'L&D', IT: 'IT and Support', ADM: 'Admin Desk', SF: 'Salesforce' };
export const p2 = (n: number) => String(n).padStart(2, '0');
