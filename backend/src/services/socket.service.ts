import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import logger from '../config/logger';
import jwt from 'jsonwebtoken';
import config from '../config';
import { isAllowedCorsOrigin } from '../config';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  companyId?: string;
  userRole?: string;
}

class SocketService {
  private io: Server | null = null;
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds
  private companySockets: Map<string, Set<string>> = new Map(); // companyId -> Set of socketIds

  initialize(httpServer: HttpServer): Server {
    this.io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          if (isAllowedCorsOrigin(origin)) {
            callback(null, origin || true);
            return;
          }

          callback(new Error(`CORS blocked for origin: ${origin || 'unknown'}`));
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
      path: '/socket.io',
    });

    // Authentication middleware
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          return next(new Error('Authentication required'));
        }

        const decoded = jwt.verify(token, config.jwt.secret) as { id: string; company_id: string; role: string };
        socket.userId = decoded.id;
        socket.companyId = decoded.company_id;
        socket.userRole = decoded.role;
        
        next();
      } catch (err) {
        next(new Error('Invalid token'));
      }
    });

    this.io.on('connection', (socket: AuthenticatedSocket) => {
      const userId = socket.userId!;
      const companyId = socket.companyId!;
      
      logger.debug('WebSocket connected', { userId, socketId: socket.id });

      // Track user socket
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(socket.id);

      // Track company socket
      if (companyId) {
        if (!this.companySockets.has(companyId)) {
          this.companySockets.set(companyId, new Set());
        }
        this.companySockets.get(companyId)!.add(socket.id);
        
        // Join company room
        socket.join(`company:${companyId}`);
      }

      // Join user-specific room
      socket.join(`user:${userId}`);

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.debug('WebSocket disconnected', { userId, socketId: socket.id });
        
        // Remove from user sockets
        const userSocketSet = this.userSockets.get(userId);
        if (userSocketSet) {
          userSocketSet.delete(socket.id);
          if (userSocketSet.size === 0) {
            this.userSockets.delete(userId);
          }
        }

        // Remove from company sockets
        if (companyId) {
          const companySocketSet = this.companySockets.get(companyId);
          if (companySocketSet) {
            companySocketSet.delete(socket.id);
            if (companySocketSet.size === 0) {
              this.companySockets.delete(companyId);
            }
          }
        }
      });

      // Handle client subscribing to specific events
      socket.on('subscribe', (room: string) => {
        // Only allow subscribing to own company's rooms
        if (room.startsWith(`company:${companyId}`) || room === `user:${userId}`) {
          socket.join(room);
          logger.debug('Socket subscribed to room', { socketId: socket.id, room });
        }
      });

      socket.on('unsubscribe', (room: string) => {
        socket.leave(room);
        logger.debug('Socket unsubscribed from room', { socketId: socket.id, room });
      });
    });

    logger.info('WebSocket server initialized');
    return this.io;
  }

  // Emit to specific user (all their connected devices)
  emitToUser(userId: string, event: string, data: any): void {
    if (this.io) {
      this.io.to(`user:${userId}`).emit(event, data);
    }
  }

  // Emit to all users in a company
  emitToCompany(companyId: string, event: string, data: any): void {
    if (this.io) {
      this.io.to(`company:${companyId}`).emit(event, data);
    }
  }

  // Emit to all connected clients (super admin broadcasts)
  emitToAll(event: string, data: any): void {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  // Get connected user count for a company
  getCompanyUserCount(companyId: string): number {
    return this.companySockets.get(companyId)?.size || 0;
  }

  // Check if user is online
  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  getIO(): Server | null {
    return this.io;
  }
}

export const socketService = new SocketService();

// Event types for type safety
export const SOCKET_EVENTS = {
  // Lead events
  LEAD_CREATED: 'lead:created',
  LEAD_UPDATED: 'lead:updated',
  LEAD_DELETED: 'lead:deleted',
  LEAD_ASSIGNED: 'lead:assigned',
  
  // Message events
  MESSAGE_NEW: 'message:new',
  CONVERSATION_UPDATED: 'conversation:updated',
  
  // Visit events
  VISIT_CREATED: 'visit:created',
  VISIT_UPDATED: 'visit:updated',
  
  // Notification events
  NOTIFICATION_NEW: 'notification:new',
  
  // Property events
  PROPERTY_CREATED: 'property:created',
  PROPERTY_UPDATED: 'property:updated',
  
  // Dashboard updates
  DASHBOARD_REFRESH: 'dashboard:refresh',
};
