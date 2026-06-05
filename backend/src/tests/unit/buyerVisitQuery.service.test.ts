import {
  isBuyerVisitStatusQuery,
} from '../../services/buyerVisitQuery.service';
import { formatCustomerSalutation } from '../../services/customerMessageFastPath.service';

describe('buyerVisitQuery.service', () => {
  it('detects common visit-status questions', () => {
    expect(isBuyerVisitStatusQuery('Any visits booked for me ??')).toBe(true);
    expect(isBuyerVisitStatusQuery('When is my visit?')).toBe(true);
    expect(isBuyerVisitStatusQuery('Do I have any visits?')).toBe(true);
    expect(isBuyerVisitStatusQuery('Show my visits')).toBe(true);
    expect(isBuyerVisitStatusQuery('hello')).toBe(false);
  });
});

describe('formatCustomerSalutation', () => {
  it('uses first name only with comma prefix', () => {
    expect(formatCustomerSalutation('Rajesh Kumar')).toBe(', Rajesh');
  });

  it('omits channel-style profile names', () => {
    expect(formatCustomerSalutation('Kannada media')).toBe('');
  });
});
