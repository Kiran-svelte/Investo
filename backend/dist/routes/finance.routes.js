"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const validate_1 = require("../middleware/validate");
const validation_1 = require("../models/validation");
const logger_1 = __importDefault(require("../config/logger"));
const emi_service_1 = require("../services/emi.service");
const router = (0, express_1.Router)();
/**
 * POST /api/calculate-emi
 * Calculate EMI for a property purchase.
 */
router.post('/calculate-emi', (0, validate_1.validate)(validation_1.calculateEmiSchema), async (req, res) => {
    try {
        const { principal, down_payment, interest_rate, tenure_months } = req.body;
        const result = (0, emi_service_1.calculateEmi)({
            principal,
            downPayment: down_payment,
            interestRate: interest_rate,
            tenureMonths: tenure_months,
        });
        res.json({
            success: true,
            data: {
                principal: result.principal,
                down_payment: result.downPayment,
                loan_amount: result.loanAmount,
                interest_rate: result.interestRate,
                tenure_months: result.tenureMonths,
                monthly_emi: result.monthlyEmi,
                total_interest: result.totalInterest,
                total_payment: result.totalPayment,
            },
        });
    }
    catch (err) {
        logger_1.default.error('EMI calculation failed', { error: err.message });
        res.status(500).json({ success: false, error: 'Failed to calculate EMI' });
    }
});
exports.default = router;
