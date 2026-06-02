import { z } from 'zod';
import { ToolContext } from '../agent-state';
import { formatCurrencyINR } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

export function createEmiTools(_context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'calculateEmi',
      description: 'Calculate home-loan EMI.',
      schema: z.object({ principal: z.number().positive(), downPayment: z.number().min(0).default(0), interestRate: z.number().positive(), tenureMonths: z.number().int().positive() }),
      func: async ({ principal, downPayment, interestRate, tenureMonths }) => {
        const loan = Math.max(principal - downPayment, 0);
        const monthlyRate = interestRate / 12 / 100;
        const emi = monthlyRate === 0 ? loan / tenureMonths : loan * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
        return [`*EMI Calculation*`, `Loan: ${formatCurrencyINR(loan)}`, `Monthly EMI: ${formatCurrencyINR(emi)}`, `Total payment: ${formatCurrencyINR(emi * tenureMonths)}`].join('\n');
      },
    }),
  ];
}
