"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCorrelatedLogger = createCorrelatedLogger;
const winston_1 = __importDefault(require("winston"));
const index_1 = __importDefault(require("./index"));
const sanitize_1 = require("../utils/sanitize");
const jsonFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format((info) => (0, sanitize_1.redactSensitiveData)(info))(), winston_1.default.format.json());
const logger = winston_1.default.createLogger({
    level: index_1.default.env === 'production' ? 'info' : 'debug',
    format: jsonFormat,
    defaultMeta: { service: 'investo-api' },
    transports: [
        new winston_1.default.transports.Console({
            format: index_1.default.env === 'production'
                ? jsonFormat
                : winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
                    const { service, correlationId, ...rest } = meta;
                    const metaStr = Object.keys(rest).length ? JSON.stringify(rest) : '';
                    const cid = correlationId ? ` [${correlationId}]` : '';
                    return `${timestamp} [${level}]${cid}: ${message} ${metaStr}`;
                })),
        }),
    ],
});
/**
 * Child logger with correlation ID propagated from HTTP request (X-Request-Id).
 */
function createCorrelatedLogger(correlationId) {
    return logger.child({ correlationId });
}
exports.default = logger;
