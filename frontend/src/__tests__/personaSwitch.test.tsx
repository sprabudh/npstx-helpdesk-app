import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { switchPersona } from '../App';
import { setToken } from '../api/client';
import { useMe } from '../api/hooks';
import type { Me } from '../api/types';
import { useUi } from '../store/ui';

const makeMe = (id: string, name: string): Me => ({
  id, name, dept: null, title: null, location: null, managerId: null, managerName: null,
  roles: [], hrCategories: [], roleCategories: {}, helpdesks: [], workHelpdesks: [],
  flags: { worker: false, headish: false, approver: false, helpdeskAdmin: false, auditor: false },
  views: [['mine', 'Raised by me']],
  permissions: { can: [], no: [] },
  counts: { followCount: 0, followingCount: 0, ccCount: 0, waiting: 0, assignedOpen: 0, unassignedInQueues: 0, myOpen: 0, myClosed: 0, notifications: 0 },
  now: '2026-11-25T06:00:00.000Z', demo: { enabled: false, clockStart: null }, outOfOffice: false,
});

const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(body),
} as unknown as Response);

function PersonaProbe({ qc }: { qc: QueryClient }) {
  const { data: me } = useMe();
  return (
    <>
      <span data-testid="me-name">{me?.name ?? 'loading'}</span>
      <button onClick={() => void switchPersona('u2', qc)}>Switch</button>
    </>
  );
}

describe('demo persona switching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
  });

  it('refetches active queries for the new user without a browser refresh', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = String(input);
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/api/auth/demo-login') {
        const body = JSON.parse(String(init?.body)) as { userId: string };
        return jsonResponse({ accessToken: `token-${body.userId}` });
      }
      if (path === '/api/me') {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const token = headers.Authorization ?? '';
        return jsonResponse(makeMe(token.replace('Bearer token-', ''), token.endsWith('u1') ? 'Old User' : 'New User'));
      }
      return jsonResponse({});
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    flushSync(() => useUi.getState().resetForPersona('u1'));
    setToken('token-u1');

    render(
      <QueryClientProvider client={qc}>
        <PersonaProbe qc={qc} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('me-name')).toHaveTextContent('Old User'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));

    await waitFor(() => expect(screen.getByTestId('me-name')).toHaveTextContent('New User'));
    expect(calls).toContain('POST /api/auth/demo-login');
    expect(calls.filter((call) => call === 'GET /api/me')).toHaveLength(2);
    expect(qc.getQueryData<Me>(['me', 'u2'])?.name).toBe('New User');
  });
});
