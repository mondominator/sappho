/**
 * Tests for ChapterModal component
 * Tests chapter list rendering, active chapter, seek behavior, and close behavior
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChapterModal from '../../components/player/ChapterModal';

const sampleChapters = [
  { title: 'Introduction', start_time: 0 },
  { title: 'Chapter 1', start_time: 120 },
  { title: 'Chapter 2', start_time: 360 },
  { title: 'Chapter 3', start_time: 600 },
];

const defaultProps = {
  chapters: sampleChapters,
  currentTime: 150, // In Chapter 1
  duration: 900,
  onSeek: vi.fn(),
  onClose: vi.fn(),
  formatTime: (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  },
};

function renderModal(overrides = {}) {
  const props = { ...defaultProps, ...overrides };
  Object.values(props).forEach(v => {
    if (typeof v === 'function' && v.mockClear) v.mockClear();
  });
  return render(<ChapterModal {...props} />);
}

describe('ChapterModal', () => {
  it('renders with Chapters heading', () => {
    renderModal();
    expect(screen.getByText('Chapters')).toBeInTheDocument();
  });

  it('renders all chapter titles', () => {
    renderModal();
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    expect(screen.getByText('Chapter 3')).toBeInTheDocument();
  });

  it('renders formatted start times for each chapter', () => {
    renderModal();
    expect(screen.getByText('0m 0s')).toBeInTheDocument(); // Introduction at 0
    expect(screen.getByText('2m 0s')).toBeInTheDocument(); // Chapter 1 at 120
    expect(screen.getByText('6m 0s')).toBeInTheDocument(); // Chapter 2 at 360
    expect(screen.getByText('10m 0s')).toBeInTheDocument(); // Chapter 3 at 600
  });

  it('marks the current chapter as active', () => {
    const { container } = renderModal({ currentTime: 150 }); // In Chapter 1
    const activeItem = container.querySelector('.chapter-modal-item.active');
    expect(activeItem).toBeInTheDocument();
    expect(activeItem.textContent).toContain('Chapter 1');
  });

  it('marks Introduction as active when at time 0', () => {
    const { container } = renderModal({ currentTime: 0 });
    const activeItem = container.querySelector('.chapter-modal-item.active');
    expect(activeItem).toBeInTheDocument();
    expect(activeItem.textContent).toContain('Introduction');
  });

  it('marks last chapter as active when near end', () => {
    const { container } = renderModal({ currentTime: 800 });
    const activeItem = container.querySelector('.chapter-modal-item.active');
    expect(activeItem).toBeInTheDocument();
    expect(activeItem.textContent).toContain('Chapter 3');
  });

  it('sets aria-current on the active chapter', () => {
    renderModal({ currentTime: 150 });
    const activeChapter = screen.getByText('Chapter 1').closest('[role="button"]');
    expect(activeChapter).toHaveAttribute('aria-current', 'true');
  });

  it('calls onSeek and onClose when a chapter is clicked', () => {
    const onSeek = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSeek, onClose });

    fireEvent.click(screen.getByText('Chapter 2').closest('[role="button"]'));

    expect(onSeek).toHaveBeenCalledWith(360); // Chapter 2 start_time
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSeek and onClose on Enter key press on a chapter', () => {
    const onSeek = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSeek, onClose });

    const chapter3 = screen.getByText('Chapter 3').closest('[role="button"]');
    fireEvent.keyDown(chapter3, { key: 'Enter' });

    expect(onSeek).toHaveBeenCalledWith(600);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSeek and onClose on Space key press on a chapter', () => {
    const onSeek = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSeek, onClose });

    const intro = screen.getByText('Introduction').closest('[role="button"]');
    fireEvent.keyDown(intro, { key: ' ' });

    expect(onSeek).toHaveBeenCalledWith(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('chapters are focusable (tabIndex=0)', () => {
    renderModal();
    const buttons = screen.getAllByRole('button');
    // Filter out the close button
    const chapterButtons = buttons.filter(b => !b.classList.contains('chapter-modal-close'));
    chapterButtons.forEach(btn => {
      expect(btn).toHaveAttribute('tabindex', '0');
    });
  });

  describe('Close behavior', () => {
    it('calls onClose when overlay is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.click(screen.getByRole('dialog'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when content area is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.click(screen.getByText('Chapters'));
      expect(onClose).not.toHaveBeenCalled();
    });

    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.click(screen.getByLabelText('Close chapters'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape key press', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('has proper dialog ARIA attributes', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Chapters');
  });
});
