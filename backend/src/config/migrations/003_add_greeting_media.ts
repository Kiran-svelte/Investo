import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ai_settings', (t) => {
    t.jsonb('greeting_media').notNullable().defaultTo('[]');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ai_settings', (t) => {
    t.dropColumn('greeting_media');
  });
}
