import {
  buildButtonMessage,
  buildListMessage,
  buildTextMessage,
} from '../../services/whatsapp/metaMessageBuilder.service';

describe('metaMessageBuilder.service', () => {
  test('buildTextMessage truncates body', () => {
    const payload = buildTextMessage('Hello buyer', '+919000000001');
    expect(payload.type).toBe('text');
    expect(payload.to).toBe('919000000001');
    expect(payload.text.body).toBe('Hello buyer');
  });

  test('buildButtonMessage enforces Meta limits', () => {
    const payload = buildButtonMessage(
      'Pick one',
      [{ id: 'book-visit-abc', title: 'Book Visit' }],
      '+919000000001',
      'Header',
      'Footer',
    );
    expect(payload.type).toBe('interactive');
    expect((payload.interactive as any).type).toBe('button');
    expect((payload.interactive as any).action.buttons).toHaveLength(1);
  });

  test('buildListMessage validates sections', () => {
    const payload = buildListMessage(
      'Choose project',
      'View list',
      [{ title: 'Projects', rows: [{ id: 'prop-1', title: 'Lake Vista' }] }],
      '+919000000001',
    );
    expect(payload.type).toBe('interactive');
    expect((payload.interactive as any).type).toBe('list');
  });
});
