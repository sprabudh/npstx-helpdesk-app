import { AbsenceRow, AttendanceRow, ATTENDANCE_CUTOFF_HOUR_IST, firstAvailable, isUnavailable } from './availability';

const day = '2026-11-04';
const at = (h: number, m = 0) => new Date(`2026-11-04T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);
const absence = (o: Partial<AbsenceRow> = {}): AbsenceRow => ({ userId: 'u3', fromDate: day, toDate: day, type: 'Leave', status: 'Approved', ...o });
const attendance = (o: Partial<AttendanceRow> = {}): AttendanceRow => ({ userId: 'u3', date: day, status: 'Absent', ...o });

describe('isUnavailable', () => {
  it('approved full-day leave covering the day makes a person unavailable', () => {
    expect(isUnavailable([absence()], [], 'u3', at(9))).toBe(true);
    expect(isUnavailable([absence({ fromDate: '2026-11-01', toDate: '2026-11-10' })], [], 'u3', at(14))).toBe(true);
  });
  it('pending or rejected leave and half-day do not count', () => {
    expect(isUnavailable([absence({ status: 'Pending' })], [], 'u3', at(9))).toBe(false);
    expect(isUnavailable([absence({ status: 'Rejected' })], [], 'u3', at(9))).toBe(false);
    expect(isUnavailable([absence({ type: 'Half-day' })], [], 'u3', at(9))).toBe(false);
  });
  it('leave outside the day does not count', () => {
    expect(isUnavailable([absence({ fromDate: '2026-11-05', toDate: '2026-11-06' })], [], 'u3', at(9))).toBe(false);
  });
  it('an Absent attendance mark only counts after the 11:00 IST cut-off', () => {
    expect(isUnavailable([], [attendance()], 'u3', at(10, 59))).toBe(false);
    expect(isUnavailable([], [attendance()], 'u3', at(ATTENDANCE_CUTOFF_HOUR_IST))).toBe(true);
  });
  it('WFH, weekly off and holiday marks never count', () => {
    for (const status of ['Present', 'WFH', 'Half-day', 'Weekly off', 'Holiday'])
      expect(isUnavailable([], [attendance({ status })], 'u3', at(14))).toBe(false);
  });
  it('is per person and per day', () => {
    expect(isUnavailable([absence({ userId: 'u9' })], [], 'u3', at(9))).toBe(false);
    expect(isUnavailable([], [attendance({ date: '2026-11-03' })], 'u3', at(14))).toBe(false);
  });
});

describe('firstAvailable', () => {
  it('returns the first candidate the predicate accepts, else null', () => {
    const people = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(firstAvailable(people, (id) => id === 'b')?.id).toBe('a');
    expect(firstAvailable(people, () => true)).toBeNull();
  });
});
