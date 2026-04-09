import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add rich media fields to properties table for WhatsApp integration
  await knex.schema.alterTable('properties', (t) => {
    // Floor plan URLs (array of image or PDF URLs)
    t.jsonb('floor_plan_urls').defaultTo('[]').comment('Array of floor plan URLs (images or PDFs)');
    
    // Price list PDF URL
    t.string('price_list_url', 500).nullable().comment('URL to price list PDF document');
    
    // Location coordinates for WhatsApp location sharing
    t.decimal('latitude', 10, 8).nullable().comment('Latitude for WhatsApp location pin (-90 to 90)');
    t.decimal('longitude', 11, 8).nullable().comment('Longitude for WhatsApp location pin (-180 to 180)');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Rollback: Remove the added columns
  await knex.schema.alterTable('properties', (t) => {
    t.dropColumn('floor_plan_urls');
    t.dropColumn('price_list_url');
    t.dropColumn('latitude');
    t.dropColumn('longitude');
  });
}
