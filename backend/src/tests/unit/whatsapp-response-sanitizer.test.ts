import {
  sanitizeBuyerOutbound,
  stripBuyerInternalMetadata,
} from '../../services/whatsapp/whatsappResponseSanitizer.service';

describe('whatsappResponseSanitizer.service', () => {
  test('stripBuyerInternalMetadata removes UUIDs and internal lines', () => {
    const dirty =
      'Great option!\nID: 550e8400-e29b-41d4-a716-446655440000\nMatch score: 92\nWorkflow "schedule_visit" failed';
    const clean = stripBuyerInternalMetadata(dirty);
    expect(clean).not.toMatch(/550e8400/i);
    expect(clean).not.toMatch(/Match score/i);
    expect(clean).not.toMatch(/Workflow/i);
    expect(clean).toContain('Great option');
  });

  test('sanitizeBuyerOutbound runs full pipeline without false booking claims', async () => {
    const text = await sanitizeBuyerOutbound({
      text: 'Your visit is booked for tomorrow at 4pm.',
      hasInventoryAlternatives: false,
      fallbackCta: 'Share your preferred time.',
      turnContext: { visitCommitted: false, workflowSuccess: false },
    });
    expect(text.toLowerCase()).not.toMatch(/your visit is booked/);
  });
});
