import { create } from 'zustand';
import type { AskResult, Hd } from '../api/types';

export interface TicketFilters {
  tab: 'open' | 'closed'; hd: string; view: string; cat: string; pri: string; status: string; reason: string; flag: string | null;
  q: string; from: string; to: string; sort: { k: string; d: 1 | -1 }; page: number;
}
export const emptyFilters = (view: string): TicketFilters => ({
  tab: 'open', hd: 'ALL', view, cat: '', pri: '', status: '', reason: '', flag: null, q: '', from: '', to: '', sort: { k: 'updated', d: -1 }, page: 1,
});
export interface DrawerState { hd?: Hd | null; cat?: string | null; pre?: { title?: string; desc?: string; sub?: string } }
export type Modal =
  | { type: 'escalate' | 'reopen' | 'reassign' | 'unfollow' | 'cancel' | 'follower'; key: string }
  | { type: 'close'; key: string; to: string }
  | { type: 'cat'; hd: string; key?: string }
  | { type: 'field'; hd: string; cat: string; id?: number }
  | { type: 'role'; userId?: string }
  | { type: 'faq'; id: number }
  | { type: 'ooo' };
interface Toast { id: number; msg: string; kind?: 'ok' | 'bad' }

interface UiState {
  userId: string | null;
  drawer: DrawerState | null;
  modal: Modal | null;
  toasts: Toast[];
  notifOpen: boolean;
  permOpen: boolean;
  demo: null | 'error' | 'loading';
  hl: string | null;
  back: string;
  dash: TicketFilters;
  adash: TicketFilters;
  fol: { rel: string; src: string; grp: 'open' | 'closed' };
  hist: { q: string; from: string; to: string; quick: string; hds: Record<string, boolean>; states: Record<string, boolean>; cat: string; scope: string };
  faq: { hd: Hd; q: string; open: Record<string, boolean>; voted: Record<string, 'yes' | 'no'> };
  an: { scope: string | null; hd: string; range: string };
  ask: { q: string; res: AskResult | null; recent: string[]; listen: boolean };
  adm: { tab: 'categories' | 'fields' | 'sla' | 'roles' | 'perf'; hd: Hd; cat: string; flash: string | null };
  aiSim: 'ok' | 'denied' | 'nospeech' | 'unclear' | 'network';
  set: (p: Partial<UiState> | ((s: UiState) => Partial<UiState>)) => void;
  toast: (msg: string, kind?: 'ok' | 'bad') => void;
  resetForPersona: (userId: string) => void;
}

let tid = 0;
const histDefaults = () => ({ q: '', from: '', to: '', quick: 'all', hds: { HR: true, LND: true, IT: true, ADM: true, SF: true }, states: { Resolved: true, Rejected: true, Cancelled: true, Closed: true, Duplicate: true }, cat: '', scope: 'mine' });

export const useUi = create<UiState>((set) => ({
  userId: null, drawer: null, modal: null, toasts: [], notifOpen: false, permOpen: false, demo: null, hl: null, back: 'tickets',
  dash: emptyFilters('mine'), adash: emptyFilters('assigned'), fol: { rel: 'ALL', src: 'ALL', grp: 'open' }, hist: histDefaults(),
  faq: { hd: 'HR', q: '', open: {}, voted: {} }, an: { scope: null, hd: 'ALL', range: '30' }, ask: { q: '', res: null, recent: [], listen: false },
  adm: { tab: 'categories', hd: 'HR', cat: 'PAY', flash: null }, aiSim: 'ok',
  set: (p) => set(typeof p === 'function' ? p : () => p),
  toast: (msg, kind) => {
    const id = ++tid;
    set((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
  resetForPersona: (userId) =>
    set((s) => ({
      userId, drawer: null, modal: null, notifOpen: false, permOpen: false, demo: null, dash: emptyFilters('mine'), adash: emptyFilters('assigned'),
      fol: { rel: 'ALL', src: 'ALL', grp: 'open' }, hist: { ...histDefaults(), scope: 'mine' }, an: { scope: null, hd: 'ALL', range: s.an.range }, ask: { q: '', res: null, recent: s.ask.recent, listen: false },
    })),
}));
