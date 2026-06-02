"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const database_1 = __importDefault(require("./database"));
const logger_1 = __importDefault(require("./logger"));
async function runMigrations(options) {
    const destroyConnection = options?.destroyConnection ?? false;
    try {
        logger_1.default.info('Running migrations...');
        const [batchNo, log] = await database_1.default.migrate.latest();
        if (log.length === 0) {
            logger_1.default.info('Database already up to date');
        }
        else {
            logger_1.default.info(`Batch ${batchNo} run: ${log.length} migrations`);
            log.forEach((l) => logger_1.default.info(`  - ${l}`));
        }
    }
    catch (error) {
        logger_1.default.error('Migration failed', { error });
        throw error;
    }
    finally {
        if (destroyConnection) {
            await database_1.default.destroy();
        }
    }
}
if (require.main === module) {
    runMigrations({ destroyConnection: true })
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}
