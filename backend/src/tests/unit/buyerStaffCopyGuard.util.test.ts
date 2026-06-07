import { containsStaffOnlyBuyerCopy, sanitizeStaffInstructionsForBuyer } from '../../utils/buyerStaffCopyGuard.util';

describe('buyerStaffCopyGuard.util', () => {
  test('detects staff upload instructions', () => {
    const dirty = 'No brochure is uploaded for Green Acres yet. Upload one in the property settings.';
    expect(containsStaffOnlyBuyerCopy(dirty)).toBe(true);
  });

  test('replaces staff brochure instructions with buyer-friendly copy', () => {
    const dirty = 'No brochure is uploaded for Green Acres yet. Upload one in the property settings.';
    const clean = sanitizeStaffInstructionsForBuyer(dirty);
    expect(clean).not.toMatch(/property settings|Upload one/i);
    expect(clean).toMatch(/brochure PDF|pricing|photos|team/i);
  });
});
