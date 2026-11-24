import { fireEvent, render, screen } from '@testing-library/react';
import { RoleForm } from '../components/modals/Modals';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn(async () => ({ toast: null })) }));
vi.mock('../api/client', () => ({ ApiError: class ApiError extends Error {}, api: apiMock }));
vi.mock('../api/hooks', () => ({ useAction: () => ({ pending: false, run: (fn: () => Promise<unknown>) => fn() }) }));

const adm = {
  people: [{ id: 'u1', name: 'Asha Kulkarni', dept: 'HR Operations', roles: ['EMP'], hrCategories: [] }],
  assignableRoles: ['HR_AGENT', 'HD_ADMIN', 'SF_ADMIN'],
};
const cfg = {
  categories: [
    { helpdesk: 'HR', key: 'PAY', name: 'Payroll and salary', active: true },
    { helpdesk: 'HR', key: 'OLD', name: 'Old category', active: false },
  ],
  roleLabels: { HR_AGENT: 'HR agent', HD_ADMIN: 'Helpdesk admin', SF_ADMIN: 'Salesforce case admin' },
};

describe('role mapping modal', () => {
  beforeEach(() => apiMock.mockClear());
  it('shows the full active HR category list immediately when HR agent is toggled on', () => {
    render(<RoleForm m={{ type: 'role', userId: 'u1' }} adm={adm} cfg={cfg} onClose={() => {}} />);
    expect(screen.queryByText('HR categories worked')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'HR agent' }));
    expect(screen.getByText('HR categories worked')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Payroll and salary' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Old category' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save roles' }));
    expect(apiMock).toHaveBeenCalledWith('/admin/people/u1/roles', {
      method: 'PUT', body: { roles: ['EMP', 'HR_AGENT'], hrCategories: [] },
    });
  });
});
