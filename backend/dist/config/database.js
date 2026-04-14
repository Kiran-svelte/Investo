"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbConfig = void 0;
const knex_1 = __importDefault(require("knex"));
const index_1 = __importDefault(require("./index"));
const dbConfig = {
    client: 'pg',
    connection: index_1.default.db.url,
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
//# sourceMappingURL=database.js.map