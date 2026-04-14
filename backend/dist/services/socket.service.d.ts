import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
declare class SocketService {
    private io;
    private userSockets;
    private companySockets;
    initialize(httpServer: HttpServer): Server;
    emitToUser(userId: string, event: string, data: any): boolean;
    emitToCompany(companyId: string, event: string, data: any): boolean;
    emitToAll(event: string, data: any): void;
    getCompanyUserCount(companyId: string): number;
    isUserOnline(userId: string): boolean;
    getIO(): Server | null;
}
export declare const socketService: SocketService;
export declare const SOCKET_EVENTS: {
    LEAD_CREATED: string;
    LEAD_UPDATED: string;
    LEAD_DELETED: string;
    LEAD_ASSIGNED: string;
    MESSAGE_NEW: string;
    CONVERSATION_UPDATED: string;
    VISIT_CREATED: string;
    VISIT_UPDATED: string;
    NOTIFICATION_NEW: string;
    PROPERTY_CREATED: string;
    PROPERTY_UPDATED: string;
    DASHBOARD_REFRESH: string;
};
export {};
//# sourceMappingURL=socket.service.d.ts.map