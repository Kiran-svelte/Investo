import {
  isMultilingualBrowseIntent,
  isMultilingualInventoryCountQuery,
  isMultilingualPropertyTypeBrowseQuery,
  parseMultilingualBrowseFilters,
  extractBrowseLocationAliases,
} from '../../utils/buyerBrowseIntent.util';

describe('buyerBrowseIntent.util', () => {
  const HINDI_PROJECT_QUERY = 'क्या मैं आपकी परियोजनाओं के बारे में जान सकता हूँ?';

  test('Hindi project browse query matches isMultilingualBrowseIntent', () => {
    expect(isMultilingualBrowseIntent(HINDI_PROJECT_QUERY)).toBe(true);
  });

  test('Hindi project query does not match visit/price guards', () => {
    expect(isMultilingualBrowseIntent('visit book karo')).toBe(false);
    expect(isMultilingualBrowseIntent('what is the price')).toBe(false);
  });

  test('isMultilingualInventoryCountQuery detects Hindi count', () => {
    expect(isMultilingualInventoryCountQuery('कितनी परियोजनाएं हैं?')).toBe(true);
    expect(isMultilingualInventoryCountQuery('kitne projects hain')).toBe(true);
  });

  test('isMultilingualPropertyTypeBrowseQuery detects Hindi villa', () => {
    expect(isMultilingualPropertyTypeBrowseQuery('क्या आपके पास विला है?')).toBe(true);
  });

  test('parseMultilingualBrowseFilters extracts villa and bhk', () => {
    expect(parseMultilingualBrowseFilters('Any 4bhk properties ?')).toEqual({ bedrooms: 4 });
    expect(parseMultilingualBrowseFilters('क्या विला है?')).toEqual({ propertyType: 'villa' });
    expect(parseMultilingualBrowseFilters('फ्लैट दिखाओ')).toEqual({ propertyType: 'apartment' });
  });

  test('extractBrowseLocationAliases maps Devanagari Whitefield', () => {
    expect(extractBrowseLocationAliases('व्हाइटफील्ड में प्रॉपर्टी')).toContain('whitefield');
  });

  test('Hindi Whitefield location matches browse intent', () => {
    expect(isMultilingualBrowseIntent('व्हाइटफील्ड में प्रोजेक्ट')).toBe(true);
  });
});
