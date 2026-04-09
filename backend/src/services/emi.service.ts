export interface EmiInput {
  principal: number;
  downPayment?: number;
  interestRate: number;
  tenureMonths: number;
}

export interface EmiResult {
  principal: number;
  downPayment: number;
  loanAmount: number;
  interestRate: number;
  tenureMonths: number;
  monthlyEmi: number;
  totalInterest: number;
  totalPayment: number;
}

export function calculateEmi(input: EmiInput): EmiResult {
  const principal = Math.max(0, input.principal);
  const downPayment = Math.max(0, input.downPayment || 0);
  const loanAmount = Math.max(principal - downPayment, 0);
  const tenureMonths = Math.max(1, Math.floor(input.tenureMonths));
  const annualRate = Math.max(0, input.interestRate);
  const monthlyRate = annualRate / 12 / 100;

  let monthlyEmi: number;
  if (monthlyRate === 0) {
    monthlyEmi = loanAmount / tenureMonths;
  } else {
    const growth = Math.pow(1 + monthlyRate, tenureMonths);
    monthlyEmi = (loanAmount * monthlyRate * growth) / (growth - 1);
  }

  if (!Number.isFinite(monthlyEmi)) {
    monthlyEmi = 0;
  }

  const totalPayment = monthlyEmi * tenureMonths;
  const totalInterest = Math.max(totalPayment - loanAmount, 0);

  return {
    principal,
    downPayment,
    loanAmount,
    interestRate: annualRate,
    tenureMonths,
    monthlyEmi: roundCurrency(monthlyEmi),
    totalInterest: roundCurrency(totalInterest),
    totalPayment: roundCurrency(totalPayment + downPayment),
  };
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
