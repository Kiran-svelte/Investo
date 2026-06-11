import { isBuyerRapportMessage } from '../../services/buyerQualification.service';

describe('buyerQualification advanced lead routing', () => {
  test('visited lead saying interested in 3BHK does not hit rapport fast path', () => {
    expect(
      isBuyerRapportMessage('I am interested in a 3BHK apartment', {
        hasPriorOutbound: true,
        leadStatus: 'visited',
      }),
    ).toBe(false);
  });

  test('visited lead bare hi still hits rapport fast path', () => {
    expect(
      isBuyerRapportMessage('Hi', {
        hasPriorOutbound: true,
        leadStatus: 'visited',
      }),
    ).toBe(true);
  });
});
