import fs from 'fs';
import path from 'path';

/**
 * Enterprise compliance: buyer interactive orchestrator must not contain
 * hardcoded English buyerTurn("...") literals — all copy via tBuyer().
 */
describe('buyerCopyCompliance', () => {
  test('whatsappInteractiveOrchestrator has no hardcoded buyerTurn string literals', () => {
    const filePath = path.join(
      __dirname,
      '../../services/whatsapp/whatsappInteractiveOrchestrator.service.ts',
    );
    const source = fs.readFileSync(filePath, 'utf8');
    const hardcoded = source.match(/buyerTurn\s*\(\s*['"`]/g);
    expect(hardcoded).toBeNull();
  });

  test('buyerEnterpriseUx.service exists as single CRM/button context module', () => {
    const filePath = path.join(__dirname, '../../services/buyer/buyerEnterpriseUx.service.ts');
    expect(fs.existsSync(filePath)).toBe(true);
    const source = fs.readFileSync(filePath, 'utf8');
    expect(source).toContain('buildBuyerCrmButtonFlags');
    expect(source).toContain('shouldUseVisitAwareButtonsOnly');
  });
});
