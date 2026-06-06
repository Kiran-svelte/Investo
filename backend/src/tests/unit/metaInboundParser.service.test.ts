import { extractCustomerMessage } from '../../services/whatsapp/metaInboundParser.service';

describe('metaInboundParser.service', () => {
  test('parses text messages', () => {
    expect(
      extractCustomerMessage({ type: 'text', text: { body: 'Hi there' } }),
    ).toEqual({
      messageText: 'Hi there',
      normalizedType: 'text',
    });
  });

  test('parses button replies', () => {
    expect(
      extractCustomerMessage({
        type: 'interactive',
        interactive: { button_reply: { id: 'visit-confirm', title: 'Confirm Visit' } },
      }),
    ).toEqual({
      messageText: 'Confirm Visit',
      normalizedType: 'interactive',
      interactiveId: 'visit-confirm',
      interactiveType: 'button_reply',
    });
  });

  test('parses list replies using description', () => {
    expect(
      extractCustomerMessage({
        type: 'interactive',
        interactive: {
          list_reply: { id: 'prop-1', title: 'Lake Vista', description: 'Whitefield 3BHK' },
        },
      }),
    ).toEqual({
      messageText: 'Whitefield 3BHK',
      normalizedType: 'interactive',
      interactiveId: 'prop-1',
      interactiveType: 'list_reply',
    });
  });
});
