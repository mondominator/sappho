import { useEffect } from 'react';

/**
 * Global keyboard shortcuts for playback control.
 * Space = play/pause, Left/Right arrow = skip backward/forward.
 * Ignores keypresses when user is typing in inputs.
 */
export function usePlayerKeyboard({ togglePlay, skipBackward, skipForward }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't capture if user is typing in an input/textarea/contenteditable
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skipBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          skipForward();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skipBackward, skipForward]);
}
