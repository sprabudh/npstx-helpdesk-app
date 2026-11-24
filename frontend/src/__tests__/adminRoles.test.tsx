import { fireEvent, render, screen } from '@testing-library/react';
import { RoleForm } from '../components/modals/Modals';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn(async () => ({ toast: null })) }));
vi.mock('../api/client', () => ({ ApiError: class ApiError extends Error {}, api: apiMock }));
vi.mock('../api/hooks', () => ({ useAction: () => ({ pending: false, run: (fn: () => Promise<unknown>) => fn() }) }));

const adm = {
  people: [{ id: 'u1', name: 'Asha Kulkarni', dept: 'HR Operations', roles: ['EMP'], hrCategories: [] }],
  assignableRoles: ['HR_AGENT', 'IT_AGENT', 'HD_ADMIN', 'SF_ADMIN'],
};
const cfg = {
  categories: [
    { helpdesk: 'HR', key: 'PAY', name: 'Payroll and salary', active: true },
    { helpdesk: 'HR', key: 'OLD', name: 'Old category', active: false },
    { helpdesk: 'IT', key: 'HW', name: 'Hardware', active: true },
    { helpdesk: 'SF', key: 'ACCESS', name: 'Salesforce access and permissions', active: true },
  ],
  roleLabels: { HR_AGENT: 'HR agent', IT_AGENT: 'IT agent', HD_ADMIN: 'Helpdesk admin', SF_ADMIN: 'Salesforce case admin' },
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
      method: 'PUT', body: { roles: ['EMP', 'HR_AGENT'], hrCategories: [], roleCategories: { HR: [] } },
    });
  });
  it('shows category checkboxes for every department whose role is selected', () => {
    render(<RoleForm m={{ type: 'role', userId: 'u1' }} adm={adm} cfg={cfg} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'IT agent' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Salesforce case admin' }));
    expect(screen.getByText('IT and Support categories worked')).toBeInTheDocument();
    expect(screen.getByText('Salesforce categories worked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hardware' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Salesforce access and permissions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save roles' }));
    expect(apiMock).toHaveBeenCalledWith('/admin/people/u1/roles', {
      method: 'PUT', body: {
        roles: ['EMP', 'IT_AGENT', 'SF_ADMIN'], hrCategories: [],
        roleCategories: { IT: ['HW'], SF: ['ACCESS'] },
      },
    });
  });
});
