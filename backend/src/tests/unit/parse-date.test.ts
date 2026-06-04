import { parseSpecificDateFromMessage } from '../../services/agent/agent-crm-query.service';

describe('parseSpecificDateFromMessage', () => {
  it('parses "6th june" style dates', () => {
    const result = parseSpecificDateFromMessage('visits on 6th june');
    expect(result).toMatch(/^\d{4}-06-06$/);
  });

  it('parses numeric date 06/06', () => {
    const result = parseSpecificDateFromMessage('visits 06/06');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns null for unrelated text', () => {
    expect(parseSpecificDateFromMessage('hello there')).toBeNull();
  });
});
