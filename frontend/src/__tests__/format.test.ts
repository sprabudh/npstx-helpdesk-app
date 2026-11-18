import { dur, fd, fdt, fmtH, ini, isoDate, sizeLabel } from '../lib/format';
import { evalCond, isRequired, isShown } from '../lib/cond';
import type { FormField } from '../api/types';

describe('format (same output as the artifact)', () => {
  it('dates in IST', () => {
    expect(fd('2026-11-04T04:00:00Z')).toBe('04 Nov');
    expect(fdt('2026-11-04T04:00:00Z')).toBe('04 Nov, 09:30');
    expect(fdt(null)).toBe('—');
    expect(isoDate('2026-11-03T20:00:00Z')).toBe('2026-11-04');
  });
  it('durations and hours', () => {
    expect(dur(26 * 3600000)).toBe('1d 2h');
    expect(dur(-(2 * 3600000 + 28 * 60000))).toBe('2h 28m');
    expect(dur(5 * 60000)).toBe('5m');
    expect(fmtH(0.5)).toBe('30 min');
    expect(fmtH(8)).toBe('8 h');
    expect(fmtH(72)).toBe('3 days');
  });
  it('initials and sizes', () => {
    expect(ini('Arjun Kumar')).toBe('AK');
    expect(ini('IT Service Desk queue', true)).toBe('Q');
    expect(sizeLabel(2048)).toBe('2 KB');
    expect(sizeLabel(3 * 1048576)).toBe('3.0 MB');
  });
});

describe('form conditions', () => {
  const field = (o: Partial<FormField>): FormField => ({ id: 1, helpdesk: 'IT', categoryKey: 'ACC', key: 'folderPath', label: 'Folder path', type: 'text', options: null, placeholder: null, hint: null, min: null, pattern: null, patternFlags: null, patternMessage: null, defaultValue: null, required: null, showWhen: null, validation: null, custom: false, active: true, sortOrder: 0, ...o });
  it('show and required rules', () => {
    const f = field({ showWhen: { field: 'accSystem', op: 'eq', value: 'Shared drive' }, required: { field: 'accSystem', op: 'eq', value: 'Shared drive' } });
    expect(isShown(f, { accSystem: 'VPN' })).toBe(false);
    expect(isShown(f, { accSystem: 'Shared drive' })).toBe(true);
    expect(isRequired(f, { accSystem: 'Shared drive' })).toBe(true);
    expect(isRequired(field({ required: true }), {})).toBe(true);
    expect(evalCond({ any: [{ field: 'a', op: 'set', value: true }, { field: 'b', op: 'in', value: ['x'] }] }, { b: 'x' })).toBe(true);
  });
});
