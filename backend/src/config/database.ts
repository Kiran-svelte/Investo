import knex, { Knex } from 'knex';
import config from './index';

const dbConfig: Knex.Config = {
  client: 'pg',
  connection: config.db.url,
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
