import { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react';

const WebSocketContext = createContext(null);

/**
 * WebSocket Provider - Provides real-time updates to the entire app
 * Automatically connects when user is logged in
 */
export function WebSocketProvider({ children }) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const listenersRef = useRef(new Map());
  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000;

  const notifyListeners = useCallback((eventType, data) => {
    // Notify specific event listeners
    const specificListeners = listenersRef.current.get(eventType) || [];
    specificListeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    });

    // Notify wildcard listeners
    const wildcardListeners = listenersRef.current.get('*') || [];
    wildcardListeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('WebSocket wildcard listener error:', error);
      }
    });
  }, []);

  const connect = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      return;
    }

    // Don't create new connection if one exists
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/notifications?token=${encodeURIComponent(token)}`;

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        reconnectAttempts.current = 0;
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastEvent(data);
          notifyListeners(data.type, data);
        } catch (error) {
          console.error('WebSocket: Failed to parse message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        wsRef.current = null;

        // Only reconnect if we have a token and haven't exceeded attempts
        const token = localStorage.getItem('token');
        if (token && reconnectAttempts.current < maxReconnectAttempts && event.code !== 1008) {
          const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      wsRef.current.onerror = () => {
        // Error event doesn't provide useful info, onclose will handle reconnection
      };
    } catch (error) {
      console.error('WebSocket: Failed to create connection:', error);
    }
  }, [notifyListeners]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttempts.current = maxReconnectAttempts; // Prevent auto-reconnect
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Subscribe to specific event types
  const subscribe = useCallback((eventType, callback) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, []);
    }
    listenersRef.current.get(eventType).push(callback);

    // Return unsubscribe function
    return () => {
      const listeners = listenersRef.current.get(eventType) || [];
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  // Connect on mount if token exists
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, []);

  // Handle login/logout
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'token') {
        if (e.newValue) {
          // Token added - connect
          reconnectAttempts.current = 0;
          setTimeout(connect, 100);
        } else {
          // Token removed - disconnect
          disconnect();
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [connect, disconnect]);

  const value = {
    isConnected,
    lastEvent,
    subscribe,
    connect,
    disconnect,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

/**
 * Hook to access WebSocket context
 */
export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

/**
 * Hook to subscribe to specific WebSocket events
 * Automatically unsubscribes on unmount
 */
export function useWebSocketEvent(eventType, callback) {
  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (callback) {
      return subscribe(eventType, callback);
    }
  }, [eventType, callback, subscribe]);
}

export default WebSocketContext;
