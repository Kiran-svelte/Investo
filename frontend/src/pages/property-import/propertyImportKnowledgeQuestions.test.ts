import { describe, expect, it } from 'vitest';
import { applyMarketingAnswer } from './propertyImportKnowledgeQuestions';
import { PROPERTY_IMPORT_DEFAULT_FORM_VALUES } from './propertyImport.utils';

describe('applyMarketingAnswer', () => {
  it('stores type knowledge and parses Indian price units safely', () => {
    const result = applyMarketingAnswer(
      {
        ...PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
        property_type: 'villa',
      },
      {},
      {
        id: 'tk_price',
        prompt: 'What is the price?',
        helpText: 'Use brochure pricing only.',
        options: ['Rs 1-2 Cr'],
        allowCustom: true,
        typeKnowledgeKey: 'price',
      },
      'Rs 1-2 Cr',
      '',
    );

    expect(result.formValues.price_min).toBe('10000000');
    expect(result.formValues.price_max).toBe('20000000');
    expect(result.draftData.type_knowledge).toEqual(expect.objectContaining({
      price: 'Rs 1-2 Cr',
    }));
  });

  it('keeps under-price answers as a max price only', () => {
    const result = applyMarketingAnswer(
      PROPERTY_IMPORT_DEFAULT_FORM_VALUES,
      {},
      {
        id: 'tk_price',
        prompt: 'What is the price?',
        helpText: 'Use brochure pricing only.',
        options: ['Under Rs 50 L'],
        allowCustom: true,
        typeKnowledgeKey: 'price',
      },
      'Under Rs 50 L',
      '',
    );

    expect(result.formValues.price_min).toBe('');
    expect(result.formValues.price_max).toBe('5000000');
  });
});
