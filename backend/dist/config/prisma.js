"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const index_1 = __importDefault(require("./index"));
const logger_1 = __importDefault(require("./logger"));
const prisma_slow_query_1 = require("./prisma-slow-query");
const adapter = new adapter_pg_1.PrismaPg({
    connectionString: index_1.default.db.url,
    max: index_1.default.db.poolMax,
    ...(index_1.default.db.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const prisma = new client_1.PrismaClient({
    adapter,
    log: [
        { level: 'query', emit: 'event' },
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
    ],
});
(0, prisma_slow_query_1.attachSlowQueryLogging)(prisma);
prisma.$on('warn', (e) => {
    logger_1.default.warn('Prisma warning', { message: e.message });
});
prisma.$on('error', (e) => {
    logger_1.default.error('Prisma error', { message: e.message });
});
exports.default = prisma;
