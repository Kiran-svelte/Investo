import config from '../../config';
import { validateBuyerOutbound } from '../../services/buyer/buyerOutboundValidator.service';

const originalFlag = config.features.outboundPropertyValidate;

afterEach(() => {
  (config.features as { outboundPropertyValidate: boolean }).outboundPropertyValidate = originalFlag;
});

const catalog = [
  { id: 'p-lake', name: 'Lake Vista', projectId: 'proj-lake' },
  { id: 'p-sunset', name: 'Sunset Heights', projectId: 'proj-sunset' },
];

describe('buyerOutboundValidator.service', () => {
  test('flag OFF leaves text unchanged', () => {
    (config.features as { outboundPropertyValidate: boolean }).outboundPropertyValidate = false;
    const text = 'Sunset Heights is ₹95L.';
    const result = validateBuyerOutbound({
      text,
      allowedPropertyIds: ['p-lake'],
      propertyNamesById: new Map([['p-lake', 'Lake Vista']]),
      catalogNamesForDetection: catalog,
      language: 'en',
    });
    expect(result.modified).toBe(false);
  });

  test('out-of-scope property sentence stripped', () => {
    (config.features as { outboundPropertyValidate: boolean }).outboundPropertyValidate = true;
    const result = validateBuyerOutbound({
      text: 'Lake Vista is great. Sunset Heights is ₹95L.',
      allowedPropertyIds: ['p-lake'],
      propertyNamesById: new Map([['p-lake', 'Lake Vista']]),
      catalogNamesForDetection: catalog,
      language: 'en',
    });
    expect(result.modified).toBe(true);
    expect(result.text).not.toMatch(/Sunset Heights/i);
  });

  test('scoped property mention is unchanged', () => {
    (config.features as { outboundPropertyValidate: boolean }).outboundPropertyValidate = true;
    const text = 'Lake Vista has lake-facing homes.';
    const result = validateBuyerOutbound({
      text,
      allowedPropertyIds: ['p-lake'],
      propertyNamesById: new Map([['p-lake', 'Lake Vista']]),
      catalogNamesForDetection: catalog,
      language: 'en',
    });
    expect(result.modified).toBe(false);
    expect(result.text).toBe(text);
  });

  test('entirely out-of-scope response is replaced with clarify offer', () => {
    (config.features as { outboundPropertyValidate: boolean }).outboundPropertyValidate = true;
    const result = validateBuyerOutbound({
      text: 'Sunset Heights is ₹95L.',
      allowedPropertyIds: ['p-lake'],
      propertyNamesById: new Map([['p-lake', 'Lake Vista']]),
      catalogNamesForDetection: catalog,
      language: 'en',
    });
    expect(result.modified).toBe(true);
    expect(result.action).toBe('replace_with_clarify');
    expect(result.text).not.toMatch(/Sunset Heights/i);
  });

  test('visit property names are allowed even outside current focus ids', () => {
    (config.features as { outboundPropertyValidate: boolean }).outboundPropertyValidate = true;
    const text = 'Your Sunset Heights visit is still confirmed.';
    const result = validateBuyerOutbound({
      text,
      allowedPropertyIds: ['p-lake'],
      propertyNamesById: new Map([['p-lake', 'Lake Vista']]),
      catalogNamesForDetection: catalog,
      visitPropertyIds: ['p-sunset'],
      language: 'en',
    });
    expect(result.modified).toBe(false);
    expect(result.text).toBe(text);
  });
});
