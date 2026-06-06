import type { ListSection, WhatsAppButton } from '../../types/whatsapp-turn.types';

const META_BODY_MAX = 1024;
const META_HEADER_MAX = 60;
const META_FOOTER_MAX = 60;
const META_BUTTON_TITLE_MAX = 20;
const META_BUTTON_ID_MAX = 256;
const META_LIST_BUTTON_MAX = 20;
const META_MAX_BUTTONS = 3;
const META_MAX_LIST_ROWS = 10;

export type MetaTextPayload = {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string };
};

export type MetaInteractivePayload = {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: Record<string, unknown>;
};

export function truncateMetaText(text: string, max: number): string {
  return text.substring(0, max);
}

export function normalizeMetaRecipient(phone: string): string {
  return phone.replace('+', '');
}

export function buildTextMessage(body: string, to: string): MetaTextPayload {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeMetaRecipient(to),
    type: 'text',
    text: { body: truncateMetaText(body, META_BODY_MAX) },
  };
}

export function buildButtonMessage(
  bodyText: string,
  buttons: WhatsAppButton[],
  to: string,
  headerText?: string | null,
  footerText?: string | null,
): MetaInteractivePayload {
  if (!buttons.length || buttons.length > META_MAX_BUTTONS) {
    throw new Error(`Must have 1-${META_MAX_BUTTONS} buttons`);
  }

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: truncateMetaText(bodyText, META_BODY_MAX) },
    action: {
      buttons: buttons.map((btn) => ({
        type: 'reply',
        reply: {
          id: btn.id.substring(0, META_BUTTON_ID_MAX),
          title: btn.title.substring(0, META_BUTTON_TITLE_MAX),
        },
      })),
    },
  };

  if (headerText) {
    interactive.header = { type: 'text', text: truncateMetaText(headerText, META_HEADER_MAX) };
  }
  if (footerText) {
    interactive.footer = { text: truncateMetaText(footerText, META_FOOTER_MAX) };
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeMetaRecipient(to),
    type: 'interactive',
    interactive,
  };
}

export function buildListMessage(
  bodyText: string,
  buttonText: string,
  sections: ListSection[],
  to: string,
  headerText?: string | null,
  footerText?: string | null,
): MetaInteractivePayload {
  if (!sections.length) {
    throw new Error('Must have at least one section');
  }

  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  if (totalRows > META_MAX_LIST_ROWS) {
    throw new Error(`Maximum ${META_MAX_LIST_ROWS} rows allowed`);
  }

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: truncateMetaText(bodyText, META_BODY_MAX) },
    action: {
      button: truncateMetaText(buttonText, META_LIST_BUTTON_MAX),
      sections: sections.map((section) => ({
        title: truncateMetaText(section.title, 24),
        rows: section.rows.map((row) => ({
          id: row.id.substring(0, META_BUTTON_ID_MAX),
          title: row.title.substring(0, 24),
          ...(row.description ? { description: row.description.substring(0, 72) } : {}),
        })),
      })),
    },
  };

  if (headerText) {
    interactive.header = { type: 'text', text: truncateMetaText(headerText, META_HEADER_MAX) };
  }
  if (footerText) {
    interactive.footer = { text: truncateMetaText(footerText, META_FOOTER_MAX) };
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeMetaRecipient(to),
    type: 'interactive',
    interactive,
  };
}
