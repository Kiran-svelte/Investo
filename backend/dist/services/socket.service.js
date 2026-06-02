"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOCKET_EVENTS = exports.socketService = void 0;
const socket_io_1 = require("socket.io");
const logger_1 = __importDefault(require("../config/logger"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = __importDefault(require("../config"));
const config_2 = require("../config");
class SocketService {
    constructor() {
        this.io = null;
        this.userSockets = new Map(); // userId -> Set of socketIds
        this.companySockets = new Map(); // companyId -> Set of socketIds
    }
    initialize(httpServer) {
        this.io = new socket_io_1.Server(httpServer, {
            cors: {
                origin: (origin, callback) => {
                    if ((0, config_2.isAllowedCorsOrigin)(origin)) {
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
        this.io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
                if (!token) {
                    return next(new Error('Authentication required'));
                }
                const decoded = jsonwebtoken_1.default.verify(token, config_1.default.jwt.secret);
                socket.userId = decoded.id;
                socket.companyId = decoded.company_id;
                socket.userRole = decoded.role;
                next();
            }
            catch (err) {
                next(new Error('Invalid token'));
            }
        });
        this.io.on('connection', (socket) => {
            const userId = socket.userId;
            const companyId = socket.companyId;
            logger_1.default.debug('WebSocket connected', { userId, socketId: socket.id });
            // Track user socket
            if (!this.userSockets.has(userId)) {
                this.userSockets.set(userId, new Set());
            }
            this.userSockets.get(userId).add(socket.id);
            // Track company socket
            if (companyId) {
                if (!this.companySockets.has(companyId)) {
                    this.companySockets.set(companyId, new Set());
                }
                this.companySockets.get(companyId).add(socket.id);
                // Join company room
                socket.join(`company:${companyId}`);
            }
            // Join user-specific room
            socket.join(`user:${userId}`);
            // Handle disconnection
            socket.on('disconnect', () => {
                logger_1.default.debug('WebSocket disconnected', { userId, socketId: socket.id });
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
            socket.on('subscribe', (room) => {
                // Only allow subscribing to own company's rooms
                if (room.startsWith(`company:${companyId}`) || room === `user:${userId}`) {
                    socket.join(room);
                    logger_1.default.debug('Socket subscribed to room', { socketId: socket.id, room });
                }
            });
            socket.on('unsubscribe', (room) => {
                socket.leave(room);
                logger_1.default.debug('Socket unsubscribed from room', { socketId: socket.id, room });
            });
        });
        logger_1.default.info('WebSocket server initialized');
        return this.io;
    }
    // Emit to specific user (all their connected devices)
    emitToUser(userId, event, data) {
        if (!this.io) {
            return false;
        }
        this.io.to(`user:${userId}`).emit(event, data);
        return true;
    }
    // Emit to all users in a company
    emitToCompany(companyId, event, data) {
        if (!this.io) {
            return false;
        }
        this.io.to(`company:${companyId}`).emit(event, data);
        return true;
    }
    // Emit to all connected clients (super admin broadcasts)
    emitToAll(event, data) {
        if (this.io) {
            this.io.emit(event, data);
        }
    }
    // Get connected user count for a company
    getCompanyUserCount(companyId) {
        return this.companySockets.get(companyId)?.size || 0;
    }
    // Check if user is online
    isUserOnline(userId) {
        return this.userSockets.has(userId);
    }
    getIO() {
        return this.io;
    }
}
exports.socketService = new SocketService();
// Event types for type safety
exports.SOCKET_EVENTS = {
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
