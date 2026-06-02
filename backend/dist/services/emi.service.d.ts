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
export declare function calculateEmi(input: EmiInput): EmiResult;
//# sourceMappingURL=emi.service.d.ts.map