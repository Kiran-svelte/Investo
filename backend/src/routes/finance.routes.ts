import { Router, Response } from 'express';
import { validate } from '../middleware/validate';
import { calculateEmiSchema } from '../models/validation';
import logger from '../config/logger';
import { calculateEmi } from '../services/emi.service';

const router = Router();

/**
 * POST /api/calculate-emi
 * Calculate EMI for a property purchase.
 */
router.post('/calculate-emi', validate(calculateEmiSchema), async (req, res: Response) => {
  try {
    const { principal, down_payment, interest_rate, tenure_months } = req.body;

    const result = calculateEmi({
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
  } catch (err: any) {
    logger.error('EMI calculation failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to calculate EMI' });
  }
});

export default router;
