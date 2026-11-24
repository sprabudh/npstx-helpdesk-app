/** Dates shown exactly as in the artifact: "04 Nov" and "04 Nov, 17:05", in IST (Asia/Kolkata). */
const IST_TZ = 'Asia/Kolkata';
let TZ = IST_TZ;
export const setTimeZone = (tz: string) => (TZ = tz || IST_TZ);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZONELESS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?(?:\.(\d+))?$/;
function asDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  const m = ZONELESS.exec(d);
  if (m) return new Date(`${m[1]}T${m[2]}:${m[3] || '00'}${m[4] ? `.${m[4]}` : ''}Z`);
  return new Date(d);
}
function parts(d: string | Date) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(asDate(d))) o[p.type] = p.value;
  return o;
}
export const fd = (d?: string | Date | null) => {
  if (!d) return '—';
  const p = parts(d);
  return `${p.day} ${MON[Number(p.month) - 1]}`;
};
export const fdt = (d?: string | Date | null) => {
  if (!d) return '—';
  const p = parts(d);
  return `${p.day} ${MON[Number(p.month) - 1]}, ${p.hour}:${p.minute}`;
};
/** Notification card stamp: "04 17:05 Nov" (DD HH:mm Mon). */
export const cardStamp = (d?: string | Date | null) => {
  if (!d) return '—';
  const p = parts(d);
  return `${p.day} ${p.hour}:${p.minute} ${MON[Number(p.month) - 1]}`;
};
/** In-app card second line: the channels the event actually used (legacy rows default to both). */
export const notifyChannel = (c?: string | null) => (c === 'in-app' ? 'in-app' : 'in-app + email');
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
