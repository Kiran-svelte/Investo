import {
  extractWebhookPhoneNumberIds,
} from '../../utils/companyWhatsAppWebhook.util';

describe('companyWhatsAppWebhook.util', () => {
  test('extractWebhookPhoneNumberIds reads metadata phone_number_id values', () => {
    const ids = extractWebhookPhoneNumberIds({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: '1090528010807708' },
            messages: [{ id: 'wamid.1' }],
          },
        }],
      }],
    });

    expect(ids).toEqual(['1090528010807708']);
  });

  test('extractWebhookPhoneNumberIds returns empty for invalid payloads', () => {
    expect(extractWebhookPhoneNumberIds(null)).toEqual([]);
    expect(extractWebhookPhoneNumberIds({ object: 'page' })).toEqual([]);
  });
});
