import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUi, type TicketFilters } from '../store/ui';
import { api, ApiError } from './client';
import type { Analytics, Config, Detail, Faq, ListItem, ListResponse, Me, Notification, Performance } from './types';

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, String(v)));
  return p.toString();
};
const uid = () => useUi.getState().userId;

export const useConfig = () => useQuery({ queryKey: ['config', uid()], queryFn: () => api<Config>('/config'), staleTime: 60000 });
export const useMe = () => useQuery({ queryKey: ['me', uid()], queryFn: () => api<Me>('/me'), refetchInterval: 15000 });
export function useTickets(f: TicketFilters) {
  return useQuery({
    queryKey: ['tickets', uid(), f],
    queryFn: () => api<ListResponse>(`/tickets?${qs({ view: f.view, hd: f.hd, tab: f.tab, cat: f.cat, pri: f.pri, status: f.status, reason: f.reason, flag: f.flag, q: f.q, from: f.from, to: f.to, sort: f.sort.k, dir: f.sort.d === 1 ? 'asc' : 'desc', page: f.page })}`),
    placeholderData: (prev) => prev,
    refetchInterval: 15000,
  });
}
export const useDetail = (key: string) => useQuery({ queryKey: ['ticket', uid(), key], queryFn: () => api<Detail>(`/tickets/${encodeURIComponent(key)}`), retry: (n, e) => !(e instanceof ApiError && [403, 404].includes(e.status)) && n < 2, refetchInterval: 15000 });
export const useFollowing = (p: { rel: string; src: string; grp: string }) => useQuery({ queryKey: ['following', uid(), p], queryFn: () => api<{ counts: Record<string, number>; rows: ListItem[] }>(`/following?${qs(p)}`), refetchInterval: 30000 });
export const useHistory = (p: Record<string, string>) => useQuery({ queryKey: ['history', uid(), p], queryFn: () => api<{ scope: string; categories: [string, string][]; sections: { helpdesk: string; rows: (ListItem & { resolutionMs: number; closedState: string })[] }[] }>(`/history?${qs(p)}`), placeholderData: (prev) => prev });
export const useFaqs = (hd: string) => useQuery({ queryKey: ['faqs', uid(), hd], queryFn: () => api<{ helpdesk: string; canEdit: boolean; faqs: Faq[] }>(`/faqs?helpdesk=${hd}`) });
export const useAnalytics = (p: { scope: string | null; hd: string; range: string }) => useQuery({ queryKey: ['analytics', uid(), p], queryFn: () => api<Analytics>(`/analytics?${qs(p)}`), placeholderData: (prev) => prev, refetchInterval: 30000 });
export const useNotifications = (enabled: boolean) => useQuery({ queryKey: ['notifications', uid()], queryFn: () => api<Notification[]>('/notifications'), enabled, refetchInterval: 15000 });
export const useApprovals = (enabled: boolean) => useQuery({ queryKey: ['approvals', uid()], queryFn: () => api<(ListItem & { stage: string; chain: { step: string; label: string; status: string; current: boolean }[]; waitingSince: string; requesterDept: string | null })[]>('/approvals/pending'), enabled, refetchInterval: 20000 });
export const usePeople = (hd: string | null | undefined) => useQuery({ queryKey: ['people', uid(), hd], queryFn: () => api<{ id: string; name: string; dept: string | null; title: string | null }[]>(`/tickets/people?hd=${hd}`), enabled: !!hd, staleTime: 60000 });
export const useRelatedOptions = (enabled: boolean) => useQuery({ queryKey: ['related', uid()], queryFn: () => api<{ key: string; title: string }[]>('/tickets/related-options'), enabled });
export const useAdmin = (enabled: boolean) => useQuery({ queryKey: ['admin', uid()], queryFn: () => api<any>('/admin'), enabled });
export const usePerformance = (p: { hd: string; range: string; q: string }, enabled: boolean) =>
  useQuery({ queryKey: ['performance', uid(), p], queryFn: () => api<Performance>(`/admin/performance?${qs(p)}`), enabled, placeholderData: (prev) => prev });

/** Runs a mutation, shows its toast, and refreshes everything that may have changed. */
export function useAction() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const m = useMutation({
    mutationFn: (fn: () => Promise<any>) => fn(),
    onSuccess: (res: any) => {
      if (res?.toast) toast(res.toast, 'ok');
      (res?.warnings as string[] | undefined)?.forEach((w) => toast(w, 'bad'));
      ['tickets', 'ticket', 'me', 'analytics', 'notifications', 'approvals', 'following', 'history', 'admin', 'config', 'related', 'faqs'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
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
