import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Me } from '../api/types';
import { BigButtons } from '../pages/DashboardPage';

type MeOverrides = Partial<Omit<Me, 'flags' | 'counts'>> & { flags?: Partial<Me['flags']>; counts?: Partial<Me['counts']> };

const baseMe = (overrides: MeOverrides = {}): Me => {
  const base: Me = {
    id: 'u1', name: 'Test User', dept: null, title: null, location: null, managerId: null, managerName: null,
    roles: [], hrCategories: [], roleCategories: {}, helpdesks: [], workHelpdesks: [],
    flags: { worker: false, headish: false, approver: false, helpdeskAdmin: false, auditor: false },
    views: [['mine', 'Raised by me'], ['following', "Following / CC'd"]],
    permissions: { can: [], no: [] },
    counts: { followCount: 0, followingCount: 0, ccCount: 0, waiting: 0, assignedOpen: 0, unassignedInQueues: 0, myOpen: 0, myClosed: 0, notifications: 0 },
    now: '2026-11-24T06:00:00.000Z', demo: { enabled: false, clockStart: null }, outOfOffice: false,
  };
  return { ...base, ...overrides, flags: { ...base.flags, ...overrides.flags }, counts: { ...base.counts, ...overrides.counts } };
};

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

function renderQuickActions(me: Me) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <BigButtons me={me} />
      <Routes><Route path="*" element={<LocationProbe />} /></Routes>
    </MemoryRouter>,
  );
}

function thirdButton(container: HTMLElement) {
  const buttons = container.querySelectorAll('button.bigbtn');
  expect(buttons).toHaveLength(3);
  expect(buttons[0]).toHaveTextContent('Raise ticket');
  expect(buttons[1]).toHaveTextContent('My tickets');
  return buttons[2];
}

describe('Dashboard quick actions', () => {
  it('shows exactly three actions with Following for a normal employee', () => {
    const { container } = renderQuickActions(baseMe({ counts: { followCount: 7, assignedOpen: 2 } }));
    const button = thirdButton(container);
    expect(button).toHaveTextContent('Following');
    expect(button).toHaveTextContent('7 open · Tickets you watch');
    expect(screen.queryByText('Assigned to me')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByTestId('path')).toHaveTextContent('/following');
  });

  it('uses Following for a manager-only department head', () => {
    const { container } = renderQuickActions(baseMe({
      roles: ['MANAGER'], flags: { headish: true, approver: true },
      views: [['mine', 'Raised by me'], ['following', "Following / CC'd"], ['approvals', 'Pending my approval']],
    }));
    const button = thirdButton(container);
    expect(button).toHaveTextContent('Following');
    fireEvent.click(button);
    expect(screen.getByTestId('path')).toHaveTextContent('/following');
  });

  it('shows Assigned to me for an agent with the accurate assigned count', () => {
    const { container } = renderQuickActions(baseMe({
      roles: ['IT_AGENT'], flags: { worker: true },
      views: [['mine', 'Raised by me'], ['following', "Following / CC'd"], ['assigned', 'Assigned to me']],
      counts: { assignedOpen: 5, followCount: 3 },
    }));
    const button = thirdButton(container);
    expect(button).toHaveTextContent('Assigned to me');
    expect(button).toHaveTextContent('5 open · Your tickets and the queues you work');
    expect(screen.queryByText('Following')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByTestId('path')).toHaveTextContent('/assigned');
  });

  it.each([
    ['HR', 'HR_AGENT'], ['L&D', 'LND_COORD'], ['IT', 'IT_AGENT'], ['Admin Desk', 'ADM_AGENT'], ['Salesforce', 'SF_ADMIN'],
  ])('shows Assigned to me for a %s category lead role', (_helpdesk, role) => {
    const { container } = renderQuickActions(baseMe({
      roles: [role], flags: { worker: true },
      views: [['mine', 'Raised by me'], ['following', "Following / CC'd"], ['assigned', 'Assigned to me']],
    }));
    const button = thirdButton(container);
    expect(button).toHaveTextContent('Assigned to me');
    fireEvent.click(button);
    expect(screen.getByTestId('path')).toHaveTextContent('/assigned');
  });

  it('uses the assigned view when the worker flag is unavailable', () => {
    const { container } = renderQuickActions(baseMe({
      views: [['mine', 'Raised by me'], ['following', "Following / CC'd"], ['assigned', 'Assigned to me']],
    }));
    const button = thirdButton(container);
    expect(button).toHaveTextContent('Assigned to me');
    fireEvent.click(button);
    expect(screen.getByTestId('path')).toHaveTextContent('/assigned');
  });
});
