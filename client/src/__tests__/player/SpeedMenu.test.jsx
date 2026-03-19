/**
 * Tests for SpeedMenu component
 * Tests preset buttons, slider interaction, and close behavior
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SpeedMenu from '../../components/player/SpeedMenu';

const defaultProps = {
  currentSpeed: 1,
  onSelect: vi.fn(),
  onClose: vi.fn(),
};

function renderMenu(overrides = {}) {
  const props = { ...defaultProps, ...overrides };
  Object.values(props).forEach(v => {
    if (typeof v === 'function' && v.mockClear) v.mockClear();
  });
  return render(<SpeedMenu {...props} />);
}

describe('SpeedMenu', () => {
  it('renders with Playback Speed heading', () => {
    renderMenu();
    expect(screen.getByText('Playback Speed')).toBeInTheDocument();
  });

  it('renders all preset speed buttons', () => {
    renderMenu();
    const presets = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    for (const preset of presets) {
      expect(screen.getByLabelText(`${preset}x speed`)).toBeInTheDocument();
    }
  });

  it('marks current speed preset as active', () => {
    renderMenu({ currentSpeed: 1.5 });
    const activeBtn = screen.getByLabelText('1.5x speed');
    expect(activeBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onSelect when a preset is clicked', () => {
    const onSelect = vi.fn();
    renderMenu({ onSelect });
    fireEvent.click(screen.getByLabelText('2x speed'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('displays current speed value in the header display', () => {
    const { container } = renderMenu({ currentSpeed: 1.5 });
    const display = container.querySelector('.speed-current-value');
    expect(display).toBeInTheDocument();
    expect(display.textContent).toBe('1.5x');
  });

  it('displays formatted speed with trailing zero for whole numbers', () => {
    const { container } = renderMenu({ currentSpeed: 2 });
    const display = container.querySelector('.speed-current-value');
    expect(display.textContent).toBe('2.0x');
  });

  it('renders a speed slider', () => {
    renderMenu();
    expect(screen.getByLabelText('Playback speed slider')).toBeInTheDocument();
  });

  it('slider has correct min, max, and step', () => {
    renderMenu();
    const slider = screen.getByLabelText('Playback speed slider');
    expect(slider).toHaveAttribute('min', '0.5');
    expect(slider).toHaveAttribute('max', '3.0');
    expect(slider).toHaveAttribute('step', '0.05');
  });

  it('calls onSelect when slider changes', () => {
    const onSelect = vi.fn();
    renderMenu({ onSelect });
    const slider = screen.getByLabelText('Playback speed slider');
    fireEvent.change(slider, { target: { value: '1.75' } });
    expect(onSelect).toHaveBeenCalledWith(1.75);
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    const overlay = screen.getByRole('dialog');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when content area is clicked', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    // Click the heading inside the content area
    fireEvent.click(screen.getByText('Playback Speed'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    fireEvent.click(screen.getByLabelText('Close speed menu'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key press', () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has proper dialog ARIA attributes', () => {
    renderMenu();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Playback speed');
  });
});
