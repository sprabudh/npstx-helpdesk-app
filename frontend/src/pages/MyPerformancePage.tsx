import { useState } from 'react';
import { ApiError } from '../api/client';
import { useMe, useMyPerformance } from '../api/hooks';
import { Denied, Skeleton } from '../components/common/bits';
import { PerfReport } from '../components/perf/PerfReport';

/** A worker's own Assignee performance rows, grouped by category. */
export default function MyPerformancePage() {
  const { data: me } = useMe();
  const [range, setRange] = useState('30');
  const [q, setQ] = useState('');
  const worker = !!me?.flags.worker;
  const { data, isLoading, error } = useMyPerformance(range);
  if (!me) return <Skeleton />;
  if (!worker || (error instanceof ApiError && error.status === 403))
    return <Denied code="403" title="My performance is for people who work tickets." text="Switch the demo role to an agent, lead or case admin to see it." />;
  const p = data && q.trim() ? { ...data, rows: data.rows.filter((r) => `${r.category ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) } : data;
  return <PerfReport mine p={p} loading={isLoading} error={error} ctl={{ range, setRange, q, setQ }} />;
}
