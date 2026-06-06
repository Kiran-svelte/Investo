import { polishOutboundMessage } from '../../services/messagePolish.service';

describe('messagePolish branding', () => {
  it('does not append platform footer on WhatsApp (white-label safe)', async () => {
    const result = await polishOutboundMessage({
      rawText: 'Here are three options for you.',
      channel: 'whatsapp',
      companyName: 'Geeky Realty',
    });
    expect(result.text).toBe('Here are three options for you.');
    expect(result.text).not.toContain('Investo');
    expect(result.text).not.toContain('Geeky Realty');
  });
});
