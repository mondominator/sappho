/**
 * Tests for SleepTimerMenu component
 * Tests duration buttons, chapter option, cancel, custom input, and close behavior
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SleepTimerMenu from '../../components/player/SleepTimerMenu';

const defaultProps = {
  sleepTimer: null,
  hasChapters: false,
  onSelect: vi.fn(),
  onClose: vi.fn(),
};

function renderMenu(overrides = {}) {
  const props = { ...defaultProps, ...overrides };
  Object.values(props).forEach(v => {
    if (typeof v === 'function' && v.mockClear) v.mockClear();
  });
  return render(<SleepTimerMenu {...props} />);
}

describe('SleepTimerMenu', () => {
  it('renders with Sleep Timer heading', () => {
    renderMenu();
    expect(screen.getByText('Sleep Timer')).toBeInTheDocument();
  });

  it('renders all preset duration buttons', () => {
    renderMenu();
    expect(screen.getByText('5 minutes')).toBeInTheDocument();
    expect(screen.getByText('10 minutes')).toBeInTheDocument();
    expect(screen.getByText('15 minutes')).toBeInTheDocument();
    expect(screen.getByText('30 minutes')).toBeInTheDocument();
    expect(screen.getByText('45 minutes')).toBeInTheDocument();
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('1.5 hours')).toBeInTheDocument();
    expect(screen.getByText('2 hours')).toBeInTheDocument();
  });

  it('calls onSelect with duration when a preset is clicked', () => {
    const onSelect = vi.fn();
    renderMenu({ onSelect });
    fireEvent.click(screen.getByText('30 minutes'));
    expect(onSelect).toHaveBeenCalledWith(30);
  });

  it('does not show cancel button when no timer is active', () => {
    renderMenu({ sleepTimer: null });
    expect(screen.queryByText('Cancel Timer')).not.toBeInTheDocument();
  });

  it('shows cancel button when a timer is active', () => {
    renderMenu({ sleepTimer: 30 });
    expect(screen.getByText('Cancel Timer')).toBeInTheDocument();
  });

  it('calls onSelect with null when cancel is clicked', () => {
    const onSelect = vi.fn();
    renderMenu({ sleepTimer: 30, onSelect });
    fireEvent.click(screen.getByText('Cancel Timer'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('does not show "End of chapter" option when no chapters', () => {
    renderMenu({ hasChapters: false });
    expect(screen.queryByText('End of chapter')).not.toBeInTheDocument();
  });

  it('shows "End of chapter" option when chapters exist', () => {
    renderMenu({ hasChapters: true });
    expect(screen.getByText('End of chapter')).toBeInTheDocument();
  });

  it('calls onSelect with "chapter" when end-of-chapter clicked', () => {
    const onSelect = vi.fn();
    renderMenu({ hasChapters: true, onSelect });
    fireEvent.click(screen.getByText('End of chapter'));
    expect(onSelect).toHaveBeenCalledWith('chapter');
  });

  it('marks active duration as active', () => {
    renderMenu({ sleepTimer: 15 });
    const activeBtn = screen.getByText('15 minutes');
    expect(activeBtn.className).toContain('active');
  });

  it('marks chapter option as active when sleepTimer is "chapter"', () => {
    renderMenu({ hasChapters: true, sleepTimer: 'chapter' });
    const chapterBtn = screen.getByText('End of chapter');
    expect(chapterBtn.className).toContain('active');
  });

  describe('Custom timer input', () => {
    it('renders custom minutes input', () => {
      renderMenu();
      expect(screen.getByLabelText('Custom timer in minutes')).toBeInTheDocument();
    });

    it('renders Set button for custom input', () => {
      renderMenu();
      expect(screen.getByLabelText('Set custom timer')).toBeInTheDocument();
    });

    it('Set button is disabled when input is empty', () => {
      renderMenu();
      expect(screen.getByLabelText('Set custom timer')).toBeDisabled();
    });

    it('calls onSelect with custom value when Set is clicked', () => {
      const onSelect = vi.fn();
      renderMenu({ onSelect });

      const input = screen.getByLabelText('Custom timer in minutes');
      fireEvent.change(input, { target: { value: '25' } });

      fireEvent.click(screen.getByLabelText('Set custom timer'));
      expect(onSelect).toHaveBeenCalledWith(25);
    });

    it('submits custom value on Enter key', () => {
      const onSelect = vi.fn();
      renderMenu({ onSelect });

      const input = screen.getByLabelText('Custom timer in minutes');
      fireEvent.change(input, { target: { value: '45' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onSelect).toHaveBeenCalledWith(45);
    });

    it('does not submit invalid custom value (zero)', () => {
      const onSelect = vi.fn();
      renderMenu({ onSelect });

      const input = screen.getByLabelText('Custom timer in minutes');
      fireEvent.change(input, { target: { value: '0' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('Close behavior', () => {
    it('calls onClose when overlay is clicked', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      fireEvent.click(screen.getByRole('dialog'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when content area is clicked', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      fireEvent.click(screen.getByText('Sleep Timer'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      fireEvent.click(screen.getByLabelText('Close sleep timer menu'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape key press', () => {
      const onClose = vi.fn();
      renderMenu({ onClose });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('has proper dialog ARIA attributes', () => {
    renderMenu();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Sleep timer');
  });
});
