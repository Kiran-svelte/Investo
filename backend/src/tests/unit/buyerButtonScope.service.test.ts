import config from '../../config';
import { validateBuyerButtonSet } from '../../services/buyer/buyerButtonScope.service';
import { resolveSituationBuyerButtons } from '../../utils/buyerSituationButtons.util';

const originalFlag = config.features.buttonScopeValidate;

afterEach(() => {
  (config.features as { buttonScopeValidate: boolean }).buttonScopeValidate = originalFlag;
});

describe('buyerButtonScope.service', () => {
  test('flag OFF returns buttons unchanged', () => {
    (config.features as { buttonScopeValidate: boolean }).buttonScopeValidate = false;
    const buttons = [{ id: 'book-visit-out-of-scope', title: 'Book Visit' }];
    expect(validateBuyerButtonSet(buttons, { allowedPropertyIds: ['p1'] })).toEqual(buttons);
  });

  test('flag ON strips out-of-scope property button', () => {
    (config.features as { buttonScopeValidate: boolean }).buttonScopeValidate = true;
    const result = validateBuyerButtonSet(
      [{ id: 'book-visit-bad-id', title: 'Book Visit' }, { id: 'call-me', title: 'Call' }],
      { allowedPropertyIds: ['p1'], language: 'en' },
    );
    expect(result.map((b) => b.id)).not.toContain('book-visit-bad-id');
    expect(result.map((b) => b.id)).toContain('call-me');
  });

  test('flag ON multi list with 4 properties has no book-visit', () => {
    (config.features as { buttonScopeValidate: boolean }).buttonScopeValidate = true;
    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Here are matching projects for you.',
      recommendedPropertyIds: ['p1', 'p2', 'p3', 'p4'],
      allowedPropertyIds: ['p1', 'p2', 'p3', 'p4'],
      browseFilters: [{ id: 'filter-apartment', title: 'Apartments' }],
      language: 'en',
    });
    const ids = buttons?.map((b) => b.id) ?? [];
    expect(ids.some((id) => id.startsWith('book-visit'))).toBe(false);
  });
});
