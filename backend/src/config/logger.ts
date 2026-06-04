import winston from 'winston';
import config from './index';
import { redactSensitiveData } from '../utils/sanitize';

const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => redactSensitiveData(info))(),
  winston.format.json(),
);

const logger = winston.createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: jsonFormat,
  defaultMeta: { service: 'investo-api' },
  transports: [
    new winston.transports.Console({
      format: config.env === 'production'
        ? jsonFormat
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const { service, correlationId, ...rest } = meta;
              const metaStr = Object.keys(rest).length ? JSON.stringify(rest) : '';
              const cid = correlationId ? ` [${correlationId}]` : '';
              return `${timestamp} [${level}]${cid}: ${message} ${metaStr}`;
            }),
          ),
    }),
  ],
});

/**
 * Child logger with correlation ID propagated from HTTP request (X-Request-Id).
 */
export function createCorrelatedLogger(correlationId: string): winston.Logger {
  return logger.child({ correlationId });
}

export default logger;
