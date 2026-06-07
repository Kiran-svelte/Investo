"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbConfig = void 0;
const knex_1 = __importDefault(require("knex"));
const index_1 = __importDefault(require("./index"));
const migrationUrl = index_1.default.db.directUrl || index_1.default.db.url;
function buildPgConnection(connectionString) {
    if (!index_1.default.db.ssl) {
        return connectionString;
    }
    let normalized = connectionString;
    try {
        const parsed = new URL(connectionString);
        parsed.searchParams.delete('sslmode');
        parsed.searchParams.delete('channel_binding');
        normalized = parsed.toString();
    }
    catch {
        // keep original string
    }
    return {
        connectionString: normalized,
        // rejectUnauthorized: true enforces TLS certificate validation.
        // Set DISABLE_DB_SSL_VERIFY=true only in development/CI environments
        // that use self-signed certificates — never in production.
        ssl: { rejectUnauthorized: process.env.DISABLE_DB_SSL_VERIFY !== 'true' },
    };
}
const dbConfig = {
    client: 'pg',
    connection: buildPgConnection(migrationUrl),
    pool: {
        min: index_1.default.db.poolMin,
        max: index_1.default.db.poolMax,
    },
    migrations: {
        directory: __dirname + '/migrations',
        extension: 'ts',
    },
    seeds: {
        directory: __dirname + '/seeds',
    },
};
exports.dbConfig = dbConfig;
const db = (0, knex_1.default)(dbConfig);
exports.default = db;
