import knex, { Knex } from 'knex';
import config from './index';

const migrationUrl = config.db.directUrl || config.db.url;

function buildPgConnection(connectionString: string): string | Knex.PgConnectionConfig {
  if (!config.db.ssl) {
    return connectionString;
  }

  let normalized = connectionString;
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('channel_binding');
    normalized = parsed.toString();
  } catch {
    // keep original string
  }

  return {
    connectionString: normalized,
    ssl: { rejectUnauthorized: false },
  };
}

const dbConfig: Knex.Config = {
  client: 'pg',
  connection: buildPgConnection(migrationUrl),
  pool: {
    min: config.db.poolMin,
    max: config.db.poolMax,
  },
  migrations: {
    directory: __dirname + '/migrations',
    extension: 'ts',
  },
  seeds: {
    directory: __dirname + '/seeds',
  },
};

const db = knex(dbConfig);

export { dbConfig };
export default db;
