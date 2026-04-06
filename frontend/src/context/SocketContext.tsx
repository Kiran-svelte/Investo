import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getAccessToken } from '../services/api';

// Socket event types
export const SOCKET_EVENTS = {
  LEAD_CREATED: 'lead:created',
  LEAD_UPDATED: 'lead:updated',
  LEAD_DELETED: 'lead:deleted',
  LEAD_ASSIGNED: 'lead:assigned',
  MESSAGE_NEW: 'message:new',
  CONVERSATION_UPDATED: 'conversation:updated',
  VISIT_CREATED: 'visit:created',
  VISIT_UPDATED: 'visit:updated',
  NOTIFICATION_NEW: 'notification:new',
  PROPERTY_CREATED: 'property:created',
  PROPERTY_UPDATED: 'property:updated',
  DASHBOARD_REFRESH: 'dashboard:refresh',
};

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  subscribe: (event: string, callback: (data: any) => void) => () => void;
  emit: (event: string, data: any) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

const getSocketUrl = (): string => {
  // Use the same origin as the API
  const apiUrl = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';
  return apiUrl.replace('/api', '');
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const listenersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  useEffect(() => {
    if (!isAuthenticated) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    const token = getAccessToken();
    if (!token) return;

    const socketUrl = getSocketUrl();
    const newSocket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      setIsConnected(false);
    });

    // Set up event forwarding to registered listeners
    Object.values(SOCKET_EVENTS).forEach((event) => {
      newSocket.on(event, (data) => {
        const callbacks = listenersRef.current.get(event);
        if (callbacks) {
          callbacks.forEach((callback) => callback(data));
        }
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [isAuthenticated, user?.id]);

  const subscribe = useCallback((event: string, callback: (data: any) => void) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = listenersRef.current.get(event);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          listenersRef.current.delete(event);
        }
      }
    };
  }, []);

  const emit = useCallback((event: string, data: any) => {
    if (socket && isConnected) {
      socket.emit(event, data);
    }
  }, [socket, isConnected]);

  return (
    <SocketContext.Provider value={{ socket, isConnected, subscribe, emit }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = (): SocketContextType => {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

// Custom hook for subscribing to socket events
export function useSocketEvent<T = any>(event: string, callback: (data: T) => void) {
  const { subscribe } = useSocket();
  
  useEffect(() => {
    return subscribe(event, callback);
  }, [event, callback, subscribe]);
}

// Custom hook for lead real-time updates
export function useLeadUpdates(onLeadCreated?: (data: any) => void, onLeadUpdated?: (data: any) => void) {
  const { subscribe } = useSocket();
  
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];
    
    if (onLeadCreated) {
      unsubscribers.push(subscribe(SOCKET_EVENTS.LEAD_CREATED, onLeadCreated));
    }
    if (onLeadUpdated) {
      unsubscribers.push(subscribe(SOCKET_EVENTS.LEAD_UPDATED, onLeadUpdated));
    }
    
    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [subscribe, onLeadCreated, onLeadUpdated]);
}

// Hook for real-time notifications
export function useNotificationUpdates(onNewNotification: (data: any) => void) {
  const { subscribe } = useSocket();
  
  useEffect(() => {
    return subscribe(SOCKET_EVENTS.NOTIFICATION_NEW, onNewNotification);
  }, [subscribe, onNewNotification]);
}

export default SocketContext;
