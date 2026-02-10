/**
 * Tests for WebSocketContext
 * Tests the WebSocket provider, hooks, and subscription system
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { WebSocketProvider, useWebSocket } from '../contexts/WebSocketContext.jsx';

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose({ code: 1000, reason: '' });
    }
  }

  // Helper to simulate connection open
  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen();
  }

  // Helper to simulate message
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  // Helper to simulate close
  simulateClose(code = 1000) {
    this.readyState = 3;
    if (this.onclose) {
      this.onclose({ code, reason: '' });
    }
  }
}

MockWebSocket.OPEN = 1;
MockWebSocket.instances = [];

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});

function wrapper({ children }) {
  return <WebSocketProvider>{children}</WebSocketProvider>;
}

describe('WebSocketContext', () => {
  describe('WebSocketProvider', () => {
    it('connects when token exists in localStorage', () => {
      localStorage.setItem('token', 'test-token');

      render(
        <WebSocketProvider>
          <div>test</div>
        </WebSocketProvider>
      );

      expect(MockWebSocket.instances.length).toBe(1);
      expect(MockWebSocket.instances[0].url).toContain('ws://');
      expect(MockWebSocket.instances[0].url).toContain('token=test-token');
    });

    it('does not connect when no token in localStorage', () => {
      render(
        <WebSocketProvider>
          <div>test</div>
        </WebSocketProvider>
      );

      expect(MockWebSocket.instances.length).toBe(0);
    });

    it('reports connected status after WebSocket opens', () => {
      localStorage.setItem('token', 'test-token');

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      expect(result.current.isConnected).toBe(false);

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);
    });

    it('reports disconnected status after WebSocket closes', () => {
      localStorage.setItem('token', 'test-token');

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });
      expect(result.current.isConnected).toBe(true);

      act(() => {
        // Close with code 1008 (policy violation) to prevent reconnect
        MockWebSocket.instances[0].simulateClose(1008);
      });
      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('useWebSocket hook', () => {
    it('throws when used outside provider', () => {
      // Suppress console.error for expected error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useWebSocket());
      }).toThrow('useWebSocket must be used within a WebSocketProvider');

      consoleSpy.mockRestore();
    });

    it('provides subscribe function', () => {
      localStorage.setItem('token', 'test-token');

      const { result } = renderHook(() => useWebSocket(), { wrapper });
      expect(typeof result.current.subscribe).toBe('function');
    });

    it('provides connect and disconnect functions', () => {
      const { result } = renderHook(() => useWebSocket(), { wrapper });
      expect(typeof result.current.connect).toBe('function');
      expect(typeof result.current.disconnect).toBe('function');
    });
  });

  describe('Subscribe/Unsubscribe', () => {
    it('notifies matching event listeners', () => {
      localStorage.setItem('token', 'test-token');

      const listener = vi.fn();
      const { result } = renderHook(() => useWebSocket(), { wrapper });

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });

      // Subscribe to 'library.update' events
      let unsubscribe;
      act(() => {
        unsubscribe = result.current.subscribe('library.update', listener);
      });

      // Simulate a matching message
      act(() => {
        MockWebSocket.instances[0].simulateMessage({
          type: 'library.update',
          data: { id: 1, title: 'New Book' },
        });
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'library.update' })
      );
    });

    it('does not notify listeners for non-matching events', () => {
      localStorage.setItem('token', 'test-token');

      const listener = vi.fn();
      const { result } = renderHook(() => useWebSocket(), { wrapper });

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
        result.current.subscribe('library.update', listener);
      });

      // Simulate a non-matching message
      act(() => {
        MockWebSocket.instances[0].simulateMessage({
          type: 'session.update',
          data: {},
        });
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribe removes the listener', () => {
      localStorage.setItem('token', 'test-token');

      const listener = vi.fn();
      const { result } = renderHook(() => useWebSocket(), { wrapper });

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });

      let unsubscribe;
      act(() => {
        unsubscribe = result.current.subscribe('library.update', listener);
      });

      // Unsubscribe
      act(() => {
        unsubscribe();
      });

      // Simulate event after unsubscribe
      act(() => {
        MockWebSocket.instances[0].simulateMessage({
          type: 'library.update',
          data: {},
        });
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('wildcard listener receives all events', () => {
      localStorage.setItem('token', 'test-token');

      const listener = vi.fn();
      const { result } = renderHook(() => useWebSocket(), { wrapper });

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
        result.current.subscribe('*', listener);
      });

      act(() => {
        MockWebSocket.instances[0].simulateMessage({
          type: 'library.update',
          data: {},
        });
      });

      act(() => {
        MockWebSocket.instances[0].simulateMessage({
          type: 'session.start',
          data: {},
        });
      });

      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('lastEvent', () => {
    it('updates lastEvent on message received', () => {
      localStorage.setItem('token', 'test-token');

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });

      expect(result.current.lastEvent).toBeNull();

      act(() => {
        MockWebSocket.instances[0].simulateMessage({
          type: 'library.update',
          data: { id: 1 },
        });
      });

      expect(result.current.lastEvent).toEqual(
        expect.objectContaining({ type: 'library.update' })
      );
    });
  });

  describe('disconnect', () => {
    it('closes the WebSocket connection', () => {
      localStorage.setItem('token', 'test-token');

      const { result } = renderHook(() => useWebSocket(), { wrapper });

      act(() => {
        MockWebSocket.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.isConnected).toBe(false);
    });
  });
});
