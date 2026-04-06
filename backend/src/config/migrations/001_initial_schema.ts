import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enable UUID extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // ── subscription_plans ──
  await knex.schema.createTable('subscription_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name', 100).notNullable();
    t.integer('max_agents').notNullable();
    t.integer('max_leads').nullable();
    t.integer('max_properties').nullable();
    t.decimal('price_monthly', 12, 2).notNullable();
    t.decimal('price_yearly', 12, 2).nullable();
    t.jsonb('features').defaultTo('[]');
    t.enu('status', ['active', 'inactive']).defaultTo('active');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── companies ──
  await knex.schema.createTable('companies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name', 255).notNullable();
    t.string('slug', 100).unique().notNullable();
    t.string('whatsapp_phone', 20).unique().nullable();
    t.uuid('plan_id').nullable().references('id').inTable('subscription_plans');
    t.enu('status', ['active', 'inactive', 'suspended']).defaultTo('active');
    t.jsonb('settings').defaultTo('{}');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // ── users ──
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('email', 255).unique().notNullable();
    t.string('phone', 20).nullable();
    t.string('password_hash', 255).notNullable();
    t.enu('role', ['super_admin', 'company_admin', 'sales_agent', 'operations', 'viewer']).notNullable();
    t.enu('status', ['active', 'inactive']).defaultTo('active');
    t.timestamp('last_login').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // ── leads ──
  await knex.schema.createTable('leads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.string('customer_name', 255).nullable();
    t.string('phone', 20).notNullable();
    t.string('email', 255).nullable();
    t.decimal('budget_min', 14, 2).nullable();
    t.decimal('budget_max', 14, 2).nullable();
    t.string('location_preference', 255).nullable();
    t.enu('property_type', ['villa', 'apartment', 'plot', 'commercial', 'other']).nullable();
    t.enu('source', ['whatsapp', 'website', 'manual', 'referral']).defaultTo('whatsapp');
    t.enu('status', ['new', 'contacted', 'visit_scheduled', 'visited', 'negotiation', 'closed_won', 'closed_lost']).defaultTo('new');
    t.uuid('assigned_agent_id').nullable().references('id').inTable('users');
    t.text('notes').nullable();
    t.string('language', 5).defaultTo('en');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.timestamp('last_contact_at').nullable();

    t.index(['company_id', 'status']);
    t.index(['company_id', 'assigned_agent_id']);
  });

  // ── conversations ──
  await knex.schema.createTable('conversations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.uuid('lead_id').nullable().references('id').inTable('leads');
    t.string('whatsapp_phone', 20).notNullable();
    t.enu('status', ['ai_active', 'agent_active', 'closed']).defaultTo('ai_active');
    t.string('language', 5).defaultTo('en');
    t.boolean('ai_enabled').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // ── messages ──
  await knex.schema.createTable('messages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('conversation_id').notNullable().references('id').inTable('conversations').onDelete('CASCADE');
    t.enu('sender_type', ['customer', 'ai', 'agent']).notNullable();
    t.text('content').notNullable();
    t.string('language', 5).nullable();
    t.string('whatsapp_message_id', 255).nullable();
    t.enu('status', ['sent', 'delivered', 'read', 'failed']).defaultTo('sent');
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['conversation_id', 'created_at']);
  });

  // ── properties ──
  await knex.schema.createTable('properties', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.string('name', 255).notNullable();
    t.string('builder', 255).nullable();
    t.string('location_city', 100).nullable();
    t.string('location_area', 100).nullable();
    t.string('location_pincode', 10).nullable();
    t.decimal('price_min', 14, 2).nullable();
    t.decimal('price_max', 14, 2).nullable();
    t.integer('bedrooms').nullable();
    t.enu('property_type', ['villa', 'apartment', 'plot', 'commercial']).nullable();
    t.jsonb('amenities').defaultTo('[]');
    t.text('description').nullable();
    t.jsonb('images').defaultTo('[]');
    t.string('brochure_url', 500).nullable();
    t.string('rera_number', 50).nullable();
    t.enu('status', ['available', 'sold', 'upcoming']).defaultTo('available');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.index(['company_id', 'status']);
  });

  // ── visits ──
  await knex.schema.createTable('visits', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.uuid('lead_id').notNullable().references('id').inTable('leads');
    t.uuid('property_id').nullable().references('id').inTable('properties');
    t.uuid('agent_id').notNullable().references('id').inTable('users');
    t.timestamp('scheduled_at').notNullable();
    t.integer('duration_minutes').defaultTo(60);
    t.enu('status', ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']).defaultTo('scheduled');
    t.text('notes').nullable();
    t.boolean('reminder_sent').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.index(['company_id', 'scheduled_at']);
    t.index(['agent_id', 'scheduled_at']);
  });

  // ── ai_settings ──
  await knex.schema.createTable('ai_settings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').notNullable().unique().references('id').inTable('companies').onDelete('CASCADE');
    t.string('business_name', 255).nullable();
    t.text('business_description').nullable();
    t.jsonb('operating_locations').defaultTo('[]');
    t.jsonb('budget_ranges').defaultTo('{}');
    t.enu('response_tone', ['formal', 'friendly', 'casual']).defaultTo('friendly');
    t.jsonb('working_hours').defaultTo('{}');
    t.jsonb('faq_knowledge').defaultTo('[]');
    t.text('greeting_template').nullable();
    t.integer('persuasion_level').defaultTo(7);
    t.boolean('auto_detect_language').defaultTo(true);
    t.string('default_language', 5).defaultTo('en');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // ── notifications ──
  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').nullable().references('id').inTable('companies');
    t.uuid('user_id').nullable().references('id').inTable('users');
    t.enu('type', ['lead_new', 'visit_reminder', 'agent_takeover', 'system', 'follow_up']).notNullable();
    t.string('title', 255).nullable();
    t.text('message').nullable();
    t.boolean('read').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── audit_logs ──
  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').nullable().references('id').inTable('companies');
    t.uuid('user_id').nullable().references('id').inTable('users');
    t.string('action', 100).notNullable();
    t.string('resource_type', 50).nullable();
    t.uuid('resource_id').nullable();
    t.jsonb('details').defaultTo('{}');
    t.string('ip_address', 45).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.index(['company_id', 'created_at']);
  });

  // ── analytics ──
  await knex.schema.createTable('analytics', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    t.date('date').notNullable();
    t.integer('leads_generated').defaultTo(0);
    t.integer('visits_scheduled').defaultTo(0);
    t.integer('visits_completed').defaultTo(0);
    t.integer('deals_closed').defaultTo(0);
    t.decimal('revenue', 14, 2).defaultTo(0);
    t.integer('ai_conversations').defaultTo(0);
    t.integer('ai_messages_sent').defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.unique(['company_id', 'date']);
  });

  // ── refresh_tokens ──
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 255).notNullable();
    t.timestamp('expires_at').notNullable();
    t.boolean('revoked').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'refresh_tokens', 'analytics', 'audit_logs', 'notifications',
    'ai_settings', 'visits', 'properties', 'messages',
    'conversations', 'leads', 'users', 'companies', 'subscription_plans',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
