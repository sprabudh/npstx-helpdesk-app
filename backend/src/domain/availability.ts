import { istDate } from '../common/clock';

/** Fix 1: availability. Pure functions so routing can be unit tested without a database. */
export interface AbsenceRow {
  userId: string;
  fromDate: string; // YYYY-MM-DD (IST)
  toDate: string; // YYYY-MM-DD (IST)
  type: string;
  status: string; // Approved | Pending | Rejected
}
export interface AttendanceRow {
  userId: string;
  date: string; // YYYY-MM-DD (IST)
  status: string; // Present | WFH | Absent | Half-day | Weekly off | Holiday
}

/** Attendance absent only counts after the 11:00 IST cut-off, so a late mark does not unfairly drop cover. */
export const ATTENDANCE_CUTOFF_HOUR_IST = 11;

const dateToMs = (d: string) => Date.parse(`${d}T00:00:00+05:30`);

/**
 * A person is unavailable at `at` when they have an approved full-day leave covering the IST date,
 * or an Absent attendance mark for that date once the 11:00 IST cut-off has passed.
 * Weekly offs, holidays, WFH, half-day, and pending/rejected leave do NOT count (TC).
 */
export function isUnavailable(absences: AbsenceRow[], attendance: AttendanceRow[], userId: string, at: Date): boolean {
  const day = istDate(at);
  const covered = absences.some(
    (a) => a.userId === userId && a.status === 'Approved' && a.type !== 'Half-day' && a.fromDate <= day && day <= a.toDate,
  );
  if (covered) return true;
  const cutoff = dateToMs(day) + ATTENDANCE_CUTOFF_HOUR_IST * 3600000;
  return attendance.some((a) => a.userId === userId && a.date === day && a.status === 'Absent' && at.getTime() >= cutoff);
}

/** First candidate who is available, else null. */
export function firstAvailable<T extends { id: string }>(candidates: T[], unavailable: (id: string) => boolean): T | null {
  return candidates.find((c) => !unavailable(c.id)) ?? null;
}
