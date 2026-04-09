import { calculateEmi } from '../../services/emi.service';

describe('EMI Service', () => {
  test('calculates EMI with interest', () => {
    const result = calculateEmi({
      principal: 5000000,
      downPayment: 1000000,
      interestRate: 8.5,
      tenureMonths: 240,
    });

    expect(result.principal).toBe(5000000);
    expect(result.downPayment).toBe(1000000);
    expect(result.loanAmount).toBe(4000000);
    expect(result.tenureMonths).toBe(240);
    expect(result.monthlyEmi).toBeGreaterThan(0);
    expect(result.totalInterest).toBeGreaterThan(0);
    expect(result.totalPayment).toBeGreaterThan(result.loanAmount);
  });

  test('calculates EMI with zero interest as simple division', () => {
    const result = calculateEmi({
      principal: 2400000,
      downPayment: 400000,
      interestRate: 0,
      tenureMonths: 20,
    });

    expect(result.loanAmount).toBe(2000000);
    expect(result.monthlyEmi).toBe(100000);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPayment).toBe(2400000);
  });
});
