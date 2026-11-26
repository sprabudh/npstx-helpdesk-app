import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUi, type TicketFilters } from '../store/ui';
import { api, ApiError } from './client';
import type { Absences, Analytics, Config, Detail, Faq, ListItem, ListResponse, Me, Notification, Performance, Persona } from './types';

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, String(v)));
  return p.toString();
};
const useUid = () => useUi((s) => s.userId);

export const useConfig = () => useQuery({ queryKey: ['config', useUid()], queryFn: () => api<Config>('/config'), staleTime: 60000 });
export const useMe = () => useQuery({ queryKey: ['me', useUid()], queryFn: () => api<Me>('/me'), refetchInterval: 15000 });
export function useTickets(f: TicketFilters) {
  return useQuery({
    queryKey: ['tickets', useUid(), f],
    queryFn: () => api<ListResponse>(`/tickets?${qs({ view: f.view, hd: f.hd, tab: f.tab, cat: f.cat, pri: f.pri, status: f.status, reason: f.reason, flag: f.flag, q: f.q, from: f.from, to: f.to, sort: f.sort.k, dir: f.sort.d === 1 ? 'asc' : 'desc', page: f.page })}`),
    placeholderData: (prev) => prev,
    refetchInterval: 15000,
  });
}
export const useDetail = (key: string) => useQuery({ queryKey: ['ticket', useUid(), key], queryFn: () => api<Detail>(`/tickets/${encodeURIComponent(key)}`), retry: (n, e) => !(e instanceof ApiError && [403, 404].includes(e.status)) && n < 2, refetchInterval: 15000 });
export const useFollowing = (p: { rel: string; src: string; grp: string }) => useQuery({ queryKey: ['following', useUid(), p], queryFn: () => api<{ counts: Record<string, number>; rows: ListItem[] }>(`/following?${qs(p)}`), refetchInterval: 30000 });
export const useHistory = (p: Record<string, string>) => useQuery({ queryKey: ['history', useUid(), p], queryFn: () => api<{ scope: string; categories: [string, string][]; sections: { helpdesk: string; rows: (ListItem & { resolutionMs: number; closedState: string })[] }[] }>(`/history?${qs(p)}`), placeholderData: (prev) => prev });
export const useFaqs = (hd: string) => useQuery({ queryKey: ['faqs', useUid(), hd], queryFn: () => api<{ helpdesk: string; canEdit: boolean; faqs: Faq[] }>(`/faqs?helpdesk=${hd}`) });
export const useAnalytics = (p: { scope: string | null; hd: string; range: string }) => useQuery({ queryKey: ['analytics', useUid(), p], queryFn: () => api<Analytics>(`/analytics?${qs(p)}`), placeholderData: (prev) => prev, refetchInterval: 30000 });
export const useNotifications = (enabled: boolean) => useQuery({ queryKey: ['notifications', useUid()], queryFn: () => api<Notification[]>('/notifications'), enabled, refetchInterval: 15000 });
export const useApprovals = (enabled: boolean) => useQuery({ queryKey: ['approvals', useUid()], queryFn: () => api<(ListItem & { stage: string; chain: { step: string; label: string; status: string; current: boolean }[]; waitingSince: string; requesterDept: string | null })[]>('/approvals/pending'), enabled, refetchInterval: 20000 });
export const usePeople = (hd: string | null | undefined) => useQuery({ queryKey: ['people', useUid(), hd], queryFn: () => api<{ id: string; name: string; dept: string | null; title: string | null }[]>(`/tickets/people?hd=${hd}`), enabled: !!hd, staleTime: 60000 });
export const useRelatedOptions = (enabled: boolean) => useQuery({ queryKey: ['related', useUid()], queryFn: () => api<{ key: string; title: string }[]>('/tickets/related-options'), enabled });
export const useAdmin = (enabled: boolean) => useQuery({ queryKey: ['admin', useUid()], queryFn: () => api<any>('/admin'), enabled });
export const usePerformance = (p: { hd: string; range: string; q: string; group: string }, enabled: boolean) =>
  useQuery({ queryKey: ['performance', useUid(), p], queryFn: () => api<Performance>(`/admin/performance?${qs(p)}`), enabled, placeholderData: (prev) => prev });
export const useMyPerformance = (range: string) =>
  useQuery({ queryKey: ['performance', useUid(), 'me', range], queryFn: () => api<Performance>(`/performance/me?${qs({ range })}`), placeholderData: (prev) => prev, retry: false });
export const usePersonas = () =>
  useQuery({ queryKey: ['personas'], queryFn: () => api<{ defaultUserId: string; groups: { label: string; people: Persona[] }[] }>('/auth/personas'), retry: false });
export const useAbsences = (enabled: boolean) => useQuery({ queryKey: ['absences', useUid()], queryFn: () => api<Absences>('/demo/absences'), enabled });

/** Runs a mutation, shows its toast, and refreshes everything that may have changed. */
export function useAction() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const m = useMutation({
    mutationFn: (fn: () => Promise<any>) => fn(),
    onSuccess: (res: any) => {
      if (res?.toast) toast(res.toast, 'ok');
      (res?.warnings as string[] | undefined)?.forEach((w) => toast(w, 'bad'));
      ['tickets', 'ticket', 'me', 'analytics', 'notifications', 'approvals', 'following', 'history', 'admin', 'config', 'related', 'faqs', 'personas', 'absences', 'performance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
  return {
    run: async (fn: () => Promise<any>, opts: { silent?: boolean } = {}) => {
      try {
        return await m.mutateAsync(fn);
      } catch (e) {
        if (!opts.silent) toast(e instanceof Error ? e.message : 'Something went wrong', 'bad');
        throw e;
      }
    },
    pending: m.isPending,
  };
}

/** Admin mutations update the cached overview immediately, then refetch and roll back on error. */
export function useAdminAction() {
  const qc = useQueryClient();
  const act = useAction();
  const userId = useUid();
  const key = () => ['admin', userId] as const;
  const patch = (mutate: (a: any) => any) => qc.setQueryData<any>(key(), (old: any) => old ? mutate(JSON.parse(JSON.stringify(old))) : old);
  const runPatch = async (fn: () => Promise<any>, mutate: (a: any) => any, opts: { silent?: boolean } = {}) => {
    const before = qc.getQueryData<any>(key());
    patch(mutate);
    try {
      return await act.run(fn, opts);
    } catch (e) {
      qc.setQueryData(key(), before);
      throw e;
    }
  };
  return { run: act.run, pending: act.pending, patch, runPatch };
}
