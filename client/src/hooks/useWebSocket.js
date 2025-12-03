import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Custom hook for WebSocket connection with automatic reconnection
 * Provides real-time updates from the server
 */
export function useWebSocket(onMessage) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000;

  const connect = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      console.log('WebSocket: No token available, skipping connection');
      return;
    }

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/notifications?token=${encodeURIComponent(token)}`;

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket: Connected');
        setIsConnected(true);
        reconnectAttempts.current = 0;
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
          if (onMessage) {
            onMessage(data);
          }
        } catch (error) {
          console.error('WebSocket: Failed to parse message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('WebSocket: Disconnected', event.code, event.reason);
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts.current);
          reconnectAttempts.current++;
          console.log(`WebSocket: Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket: Error', error);
      };
    } catch (error) {
      console.error('WebSocket: Failed to create connection:', error);
    }
  }, [onMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Reconnect when token changes (e.g., after login)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'token') {
        disconnect();
        if (e.newValue) {
          setTimeout(connect, 100);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [connect, disconnect]);

  return {
    isConnected,
    lastMessage,
    reconnect: connect,
    disconnect,
  };
}

/**
 * Hook specifically for library updates
 * Returns functions to subscribe to specific event types
 */
export function useLibraryUpdates() {
  const [libraryEvents, setLibraryEvents] = useState([]);
  const listenersRef = useRef(new Map());

  const handleMessage = useCallback((data) => {
    // Only handle library-related events
    if (data.type?.startsWith('library.') || data.type === 'progress.update') {
      setLibraryEvents(prev => [...prev.slice(-99), data]); // Keep last 100 events

      // Notify specific listeners
      const listeners = listenersRef.current.get(data.type) || [];
      listeners.forEach(callback => callback(data));

      // Notify 'all' listeners
      const allListeners = listenersRef.current.get('all') || [];
      allListeners.forEach(callback => callback(data));
    }
  }, []);

  const { isConnected, lastMessage } = useWebSocket(handleMessage);

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

  return {
    isConnected,
    lastMessage,
    libraryEvents,
    subscribe,
  };
}

export default useWebSocket;
