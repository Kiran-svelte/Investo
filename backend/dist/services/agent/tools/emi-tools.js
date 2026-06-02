"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmiTools = createEmiTools;
const zod_1 = require("zod");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
function createEmiTools(_context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'calculateEmi',
            description: 'Calculate home-loan EMI.',
            schema: zod_1.z.object({ principal: zod_1.z.number().positive(), downPayment: zod_1.z.number().min(0).default(0), interestRate: zod_1.z.number().positive(), tenureMonths: zod_1.z.number().int().positive() }),
            func: async ({ principal, downPayment, interestRate, tenureMonths }) => {
                const loan = Math.max(principal - downPayment, 0);
                const monthlyRate = interestRate / 12 / 100;
                const emi = monthlyRate === 0 ? loan / tenureMonths : loan * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
                return [`*EMI Calculation*`, `Loan: ${(0, format_helpers_1.formatCurrencyINR)(loan)}`, `Monthly EMI: ${(0, format_helpers_1.formatCurrencyINR)(emi)}`, `Total payment: ${(0, format_helpers_1.formatCurrencyINR)(emi * tenureMonths)}`].join('\n');
            },
        }),
    ];
}
