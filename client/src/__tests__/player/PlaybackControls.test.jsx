/**
 * Tests for PlaybackControls component
 * Tests both desktop and fullscreen variants, button rendering, and interactions
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlaybackControls from '../../components/player/PlaybackControls';

const defaultProps = {
  playing: false,
  isBuffering: false,
  chapters: [],
  currentChapter: 0,
  onTogglePlay: vi.fn(),
  onSkipBackward: vi.fn(),
  onSkipForward: vi.fn(),
  onSkipToPreviousChapter: vi.fn(),
  onSkipToNextChapter: vi.fn(),
  onStop: vi.fn(),
};

function renderControls(overrides = {}) {
  const props = { ...defaultProps, ...overrides };
  // Reset mocks for each render
  Object.values(props).forEach(v => {
    if (typeof v === 'function' && v.mockClear) v.mockClear();
  });
  return render(<PlaybackControls {...props} />);
}

describe('PlaybackControls', () => {
  describe('Desktop variant (default)', () => {
    it('renders play button when not playing', () => {
      renderControls({ playing: false });
      const playBtn = screen.getByLabelText('Play');
      expect(playBtn).toBeInTheDocument();
    });

    it('renders pause button when playing', () => {
      renderControls({ playing: true });
      const pauseBtn = screen.getByLabelText('Pause');
      expect(pauseBtn).toBeInTheDocument();
    });

    it('renders buffering spinner when buffering', () => {
      renderControls({ isBuffering: true });
      const playBtn = screen.getByLabelText('Play');
      expect(playBtn.querySelector('.buffering-spinner')).toBeInTheDocument();
    });

    it('calls onTogglePlay when play button clicked', () => {
      const onTogglePlay = vi.fn();
      renderControls({ onTogglePlay });
      fireEvent.click(screen.getByLabelText('Play'));
      expect(onTogglePlay).toHaveBeenCalledTimes(1);
    });

    it('calls onSkipBackward when rewind button clicked', () => {
      const onSkipBackward = vi.fn();
      renderControls({ onSkipBackward });
      fireEvent.click(screen.getByLabelText('Rewind 15 seconds'));
      expect(onSkipBackward).toHaveBeenCalledTimes(1);
    });

    it('calls onSkipForward when forward button clicked', () => {
      const onSkipForward = vi.fn();
      renderControls({ onSkipForward });
      fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
      expect(onSkipForward).toHaveBeenCalledTimes(1);
    });

    it('renders stop button when onStop is provided', () => {
      renderControls({ onStop: vi.fn() });
      expect(screen.getByLabelText('Stop playback')).toBeInTheDocument();
    });

    it('calls onStop when stop button clicked', () => {
      const onStop = vi.fn();
      renderControls({ onStop });
      fireEvent.click(screen.getByLabelText('Stop playback'));
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('does not render stop button when onStop is not provided', () => {
      renderControls({ onStop: undefined });
      expect(screen.queryByLabelText('Stop playback')).not.toBeInTheDocument();
    });

    it('does not render chapter skip buttons when no chapters', () => {
      renderControls({ chapters: [] });
      expect(screen.queryByLabelText('Previous chapter')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Next chapter')).not.toBeInTheDocument();
    });

    it('renders chapter skip buttons when chapters exist', () => {
      const chapters = [
        { title: 'Ch 1', start_time: 0 },
        { title: 'Ch 2', start_time: 300 },
        { title: 'Ch 3', start_time: 600 },
      ];
      renderControls({ chapters, currentChapter: 1 });
      expect(screen.getByLabelText('Previous chapter')).toBeInTheDocument();
      expect(screen.getByLabelText('Next chapter')).toBeInTheDocument();
    });

    it('disables previous chapter button on first chapter', () => {
      const chapters = [
        { title: 'Ch 1', start_time: 0 },
        { title: 'Ch 2', start_time: 300 },
      ];
      renderControls({ chapters, currentChapter: 0 });
      expect(screen.getByLabelText('Previous chapter')).toBeDisabled();
    });

    it('disables next chapter button on last chapter', () => {
      const chapters = [
        { title: 'Ch 1', start_time: 0 },
        { title: 'Ch 2', start_time: 300 },
      ];
      renderControls({ chapters, currentChapter: 1 });
      expect(screen.getByLabelText('Next chapter')).toBeDisabled();
    });

    it('calls onSkipToPreviousChapter when previous chapter clicked', () => {
      const onSkipToPreviousChapter = vi.fn();
      const chapters = [
        { title: 'Ch 1', start_time: 0 },
        { title: 'Ch 2', start_time: 300 },
      ];
      renderControls({ chapters, currentChapter: 1, onSkipToPreviousChapter });
      fireEvent.click(screen.getByLabelText('Previous chapter'));
      expect(onSkipToPreviousChapter).toHaveBeenCalledTimes(1);
    });

    it('calls onSkipToNextChapter when next chapter clicked', () => {
      const onSkipToNextChapter = vi.fn();
      const chapters = [
        { title: 'Ch 1', start_time: 0 },
        { title: 'Ch 2', start_time: 300 },
      ];
      renderControls({ chapters, currentChapter: 0, onSkipToNextChapter });
      fireEvent.click(screen.getByLabelText('Next chapter'));
      expect(onSkipToNextChapter).toHaveBeenCalledTimes(1);
    });

    it('has proper ARIA group role', () => {
      renderControls();
      expect(screen.getByRole('group', { name: 'Playback controls' })).toBeInTheDocument();
    });
  });

  describe('Fullscreen variant', () => {
    it('renders fullscreen controls with correct class', () => {
      const { container } = renderControls({ variant: 'fullscreen' });
      expect(container.querySelector('.fullscreen-controls')).toBeInTheDocument();
    });

    it('renders play/pause in fullscreen variant', () => {
      renderControls({ variant: 'fullscreen', playing: false });
      expect(screen.getByLabelText('Play')).toBeInTheDocument();
    });

    it('renders pause in fullscreen variant when playing', () => {
      renderControls({ variant: 'fullscreen', playing: true });
      expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    });

    it('renders rewind and forward buttons in fullscreen', () => {
      renderControls({ variant: 'fullscreen' });
      expect(screen.getByLabelText('Rewind 15 seconds')).toBeInTheDocument();
      expect(screen.getByLabelText('Forward 15 seconds')).toBeInTheDocument();
    });

    it('renders chapter buttons in fullscreen when chapters exist', () => {
      const chapters = [
        { title: 'Ch 1', start_time: 0 },
        { title: 'Ch 2', start_time: 300 },
      ];
      renderControls({ variant: 'fullscreen', chapters, currentChapter: 0 });
      expect(screen.getByLabelText('Previous chapter')).toBeInTheDocument();
      expect(screen.getByLabelText('Next chapter')).toBeInTheDocument();
    });

    it('does not render chapter buttons in fullscreen when no chapters', () => {
      renderControls({ variant: 'fullscreen', chapters: [] });
      expect(screen.queryByLabelText('Previous chapter')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Next chapter')).not.toBeInTheDocument();
    });

    it('renders buffering spinner in fullscreen', () => {
      renderControls({ variant: 'fullscreen', isBuffering: true });
      const playBtn = screen.getByLabelText('Play');
      expect(playBtn.querySelector('.buffering-spinner')).toBeInTheDocument();
    });

    it('calls callbacks in fullscreen variant', () => {
      const onTogglePlay = vi.fn();
      const onSkipBackward = vi.fn();
      const onSkipForward = vi.fn();
      renderControls({ variant: 'fullscreen', onTogglePlay, onSkipBackward, onSkipForward });

      fireEvent.click(screen.getByLabelText('Play'));
      expect(onTogglePlay).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByLabelText('Rewind 15 seconds'));
      expect(onSkipBackward).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
      expect(onSkipForward).toHaveBeenCalledTimes(1);
    });
  });
});
