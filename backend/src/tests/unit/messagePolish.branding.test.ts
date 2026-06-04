import { polishOutboundMessage } from '../../services/messagePolish.service';

describe('messagePolish branding', () => {
  it('appends company footer on WhatsApp when name absent', async () => {
    const result = await polishOutboundMessage({
      rawText: 'Here are three options for you.',
      channel: 'whatsapp',
      companyName: 'Geeky Realty',
    });
    expect(result.text).toContain('Geeky Realty');
    expect(result.text).toContain('Investo');
  });
});
