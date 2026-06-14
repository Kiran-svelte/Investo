import {
  isBuyerVisitStatusQuery,
  isBuyerExistingVisitInquiry,
} from '../../services/buyerVisitQuery.service';
import { formatCustomerSalutation } from '../../services/customerMessageFastPath.service';

describe('buyerVisitQuery.service', () => {
  it('detects common visit-status questions', () => {
    expect(isBuyerVisitStatusQuery('Any visits booked for me ??')).toBe(true);
    expect(isBuyerVisitStatusQuery('When is my visit?')).toBe(true);
    expect(isBuyerVisitStatusQuery('Do I have any visits?')).toBe(true);
    expect(isBuyerVisitStatusQuery('Show my visits')).toBe(true);
    expect(isBuyerVisitStatusQuery('For which property my visit is scheduled for ?')).toBe(true);
    expect(isBuyerVisitStatusQuery('Which property is my visit for?')).toBe(true);
    expect(isBuyerVisitStatusQuery('hello')).toBe(false);
  });

  it('detects existing-visit confirmation checks (not new booking)', () => {
    expect(isBuyerExistingVisitInquiry("Its already confirmed ryt ??")).toBe(true);
    expect(isBuyerExistingVisitInquiry('Is it already scheduled?')).toBe(true);
    expect(isBuyerExistingVisitInquiry('No its already scheduled and confirmed ..see here')).toBe(true);
    expect(isBuyerVisitStatusQuery("Its already confirmed ryt ??")).toBe(true);
    expect(isBuyerExistingVisitInquiry('Please reschedule my visit')).toBe(false);
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
