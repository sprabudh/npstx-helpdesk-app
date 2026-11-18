import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Dialog, Fld, Md, MentionText, Parts, Pill } from '../components/common/bits';

describe('shared components', () => {
  it('Md renders bold and TC markers without HTML injection', () => {
    const { container } = render(<Md text={'Paid on the **last working day** [cut-off date] <img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('b')?.textContent).toBe('last working day');
    expect(container.querySelector('mark.tc')?.textContent).toBe('TC: cut-off date');
    expect(container.querySelector('img')).toBeNull();
  });
  it('MentionText highlights @First Last', () => {
    const { container } = render(<MentionText text="Thanks @Priya Rao, done." />);
    expect(container.querySelector('.mention')?.textContent).toBe('@Priya Rao');
  });
  it('Parts renders ticket links from AI answers', () => {
    render(<MemoryRouter><Parts parts={[{ t: 'text', v: 'See ' }, { t: 'ticket', v: 'IT-000052' }]} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'IT-000052' })).toHaveAttribute('href', '/ticket/IT-000052');
  });
  it('Pill uses the server class and label', () => {
    const { container } = render(<Pill t={{ pill: { cls: 's-wait', label: 'Waiting for user' } }} />);
    expect(container.firstChild).toHaveClass('pill', 's-wait');
  });
  it('Fld shows the error and the AI review hint', () => {
    const { rerender } = render(<Fld id="d-title" label="Title" req err="Add a short title."><input id="d-title" /></Fld>);
    expect(screen.getByText('Add a short title.')).toHaveClass('err');
    rerender(<Fld id="d-title" label="Title" review><input id="d-title" /></Fld>);
    expect(screen.getByText('AI was not sure about this. Please check it.')).toBeInTheDocument();
  });
  it('Dialog closes on Escape', () => {
    const onClose = vi.fn();
    render(<Dialog title="Escalate IT-000050" onClose={onClose} footer={<button>OK</button>}>Body</Dialog>);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Escalate IT-000050');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
