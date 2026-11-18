import { istDate } from '../common/clock';

/**
 * Deterministic "rules" engine: the artifact's mock AI (aiParse), used when no model is configured
 * and as a safety net when the model output fails validation. Pure functions; unit tested.
 */
export interface ParseContext {
  me: { id: string; managerId: string | null };
  allowedHds: string[];
  priorities: Record<string, string[]>;
  keywords: [string, string, string, string][]; // [helpdesk, category, sub-category, regex source]
  people: { id: string; name: string; dept: string | null; isQueue: boolean; roles: string[] }[];
  sfDepartments: string[];
  today: Date;
}
export interface DraftResult {
  hd: string;
  cat: string;
  f: Record<string, string>;
  cc: string[];
  mgr: boolean;
  unsure: string[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
const fd = (s: string) => `${s.slice(8, 10)} ${MON_S[Number(s.slice(5, 7)) - 1]}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function aiTitle(s: string, cat: string, f: Record<string, string>): string {
  if (cat === 'TRAVEL' && f.fromCity) return `Travel: ${f.fromCity} to ${f.toCity}${f.departDate ? `, ${fd(f.departDate)}` : ''}${f.returnDate ? ` to ${fd(f.returnDate)}` : ''}`;
  if (cat === 'CERT' && f.learningItem) return `Certificate missing for ${f.learningItem}`;
  if (cat === 'PAY' && f.payMonth && f.sub === 'Salary credit') return `${MON_L[Number(f.payMonth.slice(5)) - 1]} salary not credited`;
  if (cat === 'ACC' && f.accSystem)
    return `${f.accessLevel ? f.accessLevel + ' access' : 'Access'} to ${f.accSystem === 'Shared drive' && f.folderPath ? f.folderPath.split('\\').pop() + ' shared drive' : f.accSystem}`;
  let t = s.split(/[,.;!?]| since | but | because | please /i)[0].trim();
  for (let i = 0; i < 3; i++) t = t.replace(/^(hi|hello|so|um|my|our|the|i need|i want|i would like|please|can you|could you|there is|a|an)\s+/i, '');
  t = cap(t);
  if (t.length > 80) t = t.slice(0, 80).replace(/\s+\S*$/, '') + '…';
  return t;
}

/** Text to { helpdesk, category, fields, cc, unsure }; { blocked: 'SF' } when the user asked for Salesforce without access. */
export function aiParse(text: string, ctx: ParseContext): DraftResult | { blocked: string } | null {
  const s = String(text || '').trim();
  const l = s.toLowerCase();
  if (s.length < 6) return null;
  let hit: [string, string, string, string] | null = null;
  let sfHit = false;
  for (const e of ctx.keywords) {
    if (new RegExp(e[3]).test(l)) {
      if (!ctx.allowedHds.includes(e[0])) {
        if (e[0] === 'SF') sfHit = true;
        continue;
      }
      hit = e;
      break;
    }
  }
  if (!hit) return sfHit || (/sales ?force/.test(l) && !ctx.allowedHds.includes('SF')) ? { blocked: 'SF' } : null;
  const [hd, cat, sub] = hit;
  const f: Record<string, string> = { sub };
  const unsure: string[] = [];
  const todayS = istDate(ctx.today);
  const urgent = /urgent|asap|immediately|critical|blocked|right now/.test(l);
  const many = /(whole|entire) (team|floor|office)|everyone|many people|all of us/.test(l);
  if (urgent && hd !== 'HR') f.pri = many && ctx.priorities[hd]?.includes('Critical') ? 'Critical' : 'High';
  f.desc = cap(s) + (/[.!?]$/.test(s) ? '' : '.');
  const dates = [...l.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/g)].map((m) => {
    const mo = MONTHS.findIndex((x) => x.startsWith(m[2])) + 1;
    const iso = `${todayS.slice(0, 4)}-${p2(mo)}-${p2(Number(m[1]))}`;
    return iso < todayS ? `${Number(todayS.slice(0, 4)) + 1}-${p2(mo)}-${p2(Number(m[1]))}` : iso;
  });
  const city = l.match(/\b(mumbai|pune|bengaluru|bangalore)\b/);
  const locOf = (x: string) => ({ mumbai: 'Mumbai HQ', pune: 'Pune', bengaluru: 'Bengaluru', bangalore: 'Bengaluru' })[x as 'pune'];
  const fl = l.match(/(\d+)(?:st|nd|rd|th)?\s+floor/);
  const mgr = /(copy|cc|keep|loop in|inform|add|include)\s+(in\s+)?my manager|manager in cc|my manager (in )?(cc|copied)/.test(l);
  const cc: string[] = [];
  for (const m of s.matchAll(/\b(?:copy|cc|keep|loop in|inform|add|include)\s+([A-Z][a-z]+)/g)) {
    const p = ctx.people.find((x) => !x.isQueue && x.name.split(' ')[0] === m[1] && x.id !== ctx.me.id);
    if (p && (hd !== 'SF' || ctx.sfDepartments.includes(p.dept ?? ''))) cc.push(p.id);
  }
  if (hd === 'IT') {
    if (cat === 'HW') {
      const dv = l.match(/\b(laptop|desktop|monitor|keyboard|mouse|headset|dock)/);
      if (dv) f.deviceType = ({ laptop: 'Laptop', desktop: 'Desktop', monitor: 'Monitor', keyboard: 'Keyboard or mouse', mouse: 'Keyboard or mouse', headset: 'Headset', dock: 'Docking station' } as Record<string, string>)[dv[1]];
      const tag = s.match(/NPX-[A-Z]{2}-\d{4}/i);
      if (tag) f.assetTag = tag[0].toUpperCase();
      else if (sub !== 'New asset request') unsure.push('assetTag');
      const sym = l.match(/(flicker\w*|black screen|not turning on|crash\w*|slow|keys? not working)[^,.]*/);
      if (sym && ['Laptop or desktop issue', 'Replacement or repair'].includes(sub)) f.errorMsg = cap(sym[0]);
      f.impact = many ? 'Many people' : /\bteam\b/.test(l) ? 'My team' : 'Only me';
      if (!many && !/only me|just me/.test(l)) unsure.push('impact');
      if (city) f.location = locOf(city[1]);
    }
    if (cat === 'SW') {
      const sw = s.match(/install\s+([A-Z][\w.+-]*(?:\s+[A-Z][\w.+-]*)?)/);
      if (sw) f.swName = sw[1];
      else unsure.push('swName');
      f.justification = f.desc;
    }
    if (cat === 'ACC') {
      if (/shared (drive|folder)/.test(l)) {
        f.accSystem = 'Shared drive';
        const fw = s.match(/([A-Z][a-z]+)\s+shared (?:drive|folder)/);
        if (fw) {
          f.folderPath = '\\\\fs01\\' + fw[1];
          unsure.push('folderPath');
        }
      } else {
        const sy = l.match(/\b(vpn|jira|confluence|github|sap)\b/);
        if (sy) f.accSystem = ({ vpn: 'VPN', jira: 'Jira', confluence: 'Confluence', github: 'GitHub', sap: 'ERP (SAP)' } as Record<string, string>)[sy[1]];
        else unsure.push('accSystem');
      }
      const lvl = /admin/.test(l) ? 'Admin' : /write|edit|modify/.test(l) ? 'Write' : /read|view/.test(l) ? 'Read' : '';
      if (lvl) f.accessLevel = lvl;
      else unsure.push('accessLevel');
      const du = l.match(/(\d+)\s*days/);
      const dur = /permanent/.test(l) ? 'Permanent' : du ? (Number(du[1]) <= 30 ? '30 days' : '90 days') : '';
      if (dur) f.duration = dur;
      if (du && ![30, 90].includes(Number(du[1]))) unsure.push('duration');
      const ap = s.match(/manager\s+([A-Z][a-z]+)/);
      const apu = ap && ctx.people.find((x) => x.name.split(' ')[0] === ap[1] && x.roles.includes('MANAGER'));
      if (apu) f.approver = apu.id;
    }
    if (cat === 'ACCT') {
      const a = /windows/.test(l) ? 'Windows sign-in' : /\bsso\b|single sign/.test(l) ? 'SSO portal' : /outlook|office|teams|365/.test(l) ? 'Microsoft 365' : /mail/.test(l) ? 'Email mailbox' : '';
      if (a) f.acctSystem = a;
      else unsure.push('acctSystem');
    }
    if (cat === 'NET') {
      const c = /wi-?fi|wireless/.test(l) ? 'Wi-Fi' : /vpn/.test(l) ? 'VPN' : /lan|ethernet|cable/.test(l) ? 'LAN or ethernet' : '';
      if (c) f.connType = c;
      const loc = /home|remote/.test(l) ? 'Remote' : city ? locOf(city[1]) : '';
      if (loc) f.location = loc;
      if (fl) f.floor = fl[1];
      f.affected = many ? 'Whole floor' : /\bteam\b/.test(l) ? 'My team' : 'Only me';
    }
    if (cat === 'EMAIL') f.tool = /teams/.test(l) ? 'Teams' : /calendar/.test(l) ? 'Calendar' : /distribution list|\bdl\b/.test(l) ? 'Distribution list' : /shared mailbox/.test(l) ? 'Shared mailbox' : 'Outlook';
    if (cat === 'SEC') {
      f.pri = 'Critical';
      const d = new Date(ctx.today.getTime() + 19800000);
      f.incidentAt = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
      unsure.push('incidentAt');
    }
  }
  if (hd === 'ADM') {
    const bl = l.match(/tower ([ab])\b/);
    const bld = bl
      ? `Mumbai HQ · Tower ${bl[1].toUpperCase()}`
      : /hinjewadi/.test(l)
        ? 'Pune · Hinjewadi'
        : /whitefield/.test(l) && cat !== 'TRAVEL'
          ? 'Bengaluru · Whitefield'
          : city && cat !== 'TRAVEL'
            ? ({ mumbai: 'Mumbai HQ · Tower A', pune: 'Pune · Hinjewadi', bengaluru: 'Bengaluru · Whitefield', bangalore: 'Bengaluru · Whitefield' } as Record<string, string>)[city[1]]
            : '';
    const spot = s.match(/\bnear\s+([^,.]+?)(?=,|\.|$|\s+please)/i);
    if (['FAC', 'SEAT', 'STAT', 'IDC', 'VIS', 'HK'].includes(cat)) {
      if (bld) f.building = bld;
      else unsure.push('building');
      if (fl) f.floor = fl[1];
      if (spot && ['FAC', 'HK'].includes(cat)) f.spot = cap(spot[1]);
    }
    if (cat === 'FAC') {
      f.urgency = /immediately|danger|spark|flood|fire|urgent/.test(l) ? 'Immediately (safety risk)' : /today|asap/.test(l) ? 'Today' : 'Can wait';
      f.pri = ({ 'Can wait': 'Low', Today: 'Medium', 'Immediately (safety risk)': 'High' } as Record<string, string>)[f.urgency];
      if (f.urgency === 'Can wait') unsure.push('urgency');
    }
    if (cat === 'TRAVEL') {
      const ft = s.match(/from\s+([A-Z][a-z]+)\s+to\s+([A-Z][a-z]+)/);
      if (ft) {
        f.fromCity = ft[1];
        f.toCity = ft[2];
      } else unsure.push('fromCity', 'toCity');
      if (dates[0]) f.departDate = dates[0];
      else unsure.push('departDate');
      if (dates[1] && /return|back/.test(l)) f.returnDate = dates[1];
      const pur = /client/.test(l) ? 'Client visit' : /conference/.test(l) ? 'Conference' : /training/.test(l) ? 'Training' : /meeting|offsite/.test(l) ? 'Internal meeting' : '';
      if (pur) f.purpose = pur;
      else unsure.push('purpose');
      const tr = l.match(/(\d+)\s+(people|of us|travellers)/);
      f.travellers = tr ? tr[1] : '1';
    }
    if (cat === 'TRANS') {
      const vn = s.match(/\b[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}\b/);
      if (vn) f.vehicleNo = vn[0];
      if (city) f.location = locOf(city[1]);
    }
    if ((cat === 'VIS' || cat === 'SEAT') && dates[0]) f[cat === 'VIS' ? 'visitDate' : 'neededFrom'] = dates[0];
    if (cat === 'PUR') {
      const cost = l.match(/(?:rs\.?|₹|inr)\s?([\d,]+)/);
      if (cost) f.cost = cost[1].replace(/,/g, '');
      f.justification = f.desc;
    }
  }
  if (hd === 'HR') {
    if (city) f.location = locOf(city[1]);
    const mo = l.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(salary|payslip)/);
    if (mo && cat === 'PAY') f.payMonth = `${todayS.slice(0, 4)}-${p2(MONTHS.indexOf(mo[1]) + 1)}`;
  }
  if (hd === 'LND') {
    f.reqType = cat === 'COURSE' ? 'course' : 'portal';
    const cn = s.match(/(?:finished|completed|done with|taking|watching|enrolled in)\s+(?:the\s+)?(.+?)\s+course/i);
    if (cn) f.learningItem = cn[1];
    else unsure.push('learningItem');
    const src = /linkedin/.test(l) ? 'LinkedIn Learning' : /skillup/.test(l) ? 'Skillup Lounge' : /workshop|session|instructor/.test(l) ? 'Instructor-led training session' : /internal/.test(l) ? 'Internal course' : '';
    if (src) f.learningSource = src;
    else unsure.push('learningSource');
    if (f.reqType === 'portal') f.problem = f.desc;
    else f.justification = f.desc;
  }
  if (hd === 'SF') {
    const op = s.match(/\b006[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/);
    if (op) f.oppId = op[0];
    const ac = s.match(/account(?:\s+name)?\s+([A-Z][\w&]*(?:\s+[A-Z][\w&]*)*)/);
    if (ac) f.account = ac[1];
    if (cat === 'DATA') {
      if (op) f.record = op[0];
      else unsure.push('record');
    }
  }
  f.title = aiTitle(s, cat, f);
  return { hd, cat, f, cc: [...new Set(cc)], mgr, unsure };
}

/** Redirect hint: which other helpdesk the text clearly belongs to (artifact REDIR rules). */
export function redirectGuess(text: string, current: string, redirect: Record<string, string>, allowed: string[], order: string[]): string | null {
  if (text.trim().length < 4 || !redirect[current] || new RegExp(redirect[current], 'i').test(text)) return null;
  return order.find((h) => h !== current && allowed.includes(h) && redirect[h] && new RegExp(redirect[h], 'i').test(text)) ?? null;
}
