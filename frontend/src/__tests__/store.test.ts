import { emptyFilters, useUi } from '../store/ui';

describe('ui store', () => {
  it('switching persona clears drawers, modals and filters but keeps recent searches', () => {
    useUi.setState({ drawer: { hd: 'IT' }, modal: { type: 'reopen', key: 'HR-000098' }, dash: { ...emptyFilters('mine'), q: 'vpn' }, ask: { q: 'x', res: null, recent: ['laptop'], listen: false } });
    useUi.getState().resetForPersona('u21');
    const s = useUi.getState();
    expect(s.userId).toBe('u21');
    expect(s.drawer).toBeNull();
    expect(s.modal).toBeNull();
    expect(s.dash.q).toBe('');
    expect(s.ask.recent).toEqual(['laptop']);
  });
  it('toasts disappear after a few seconds', () => {
    vi.useFakeTimers();
    useUi.getState().toast('Saved', 'ok');
    expect(useUi.getState().toasts.at(-1)?.msg).toBe('Saved');
    vi.advanceTimersByTime(4300);
    expect(useUi.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });
});
