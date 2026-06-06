export type EvalSeverity = 'critical' | 'high' | 'medium' | 'low';

export type EvalCase<TInput, TExpected> = {
  id: string;
  category: string;
  description: string;
  severity: EvalSeverity;
  input: TInput;
  expected: TExpected;
};

export type EvalOutcome<TActual = unknown, TExpected = unknown> = {
  id: string;
  category: string;
  description: string;
  severity: EvalSeverity;
  passed: boolean;
  actual: TActual;
  expected: TExpected;
  reason?: string;
};

export type EvalSummary = {
  total: number;
  passed: number;
  failed: number;
  criticalFailed: number;
};

export function runEvalCases<TInput, TExpected, TActual>(
  cases: Array<EvalCase<TInput, TExpected>>,
  evaluator: (testCase: EvalCase<TInput, TExpected>) => {
    actual: TActual;
    passed: boolean;
    reason?: string;
  },
): Array<EvalOutcome<TActual, TExpected>> {
  return cases.map((testCase) => {
    const result = evaluator(testCase);
    return {
      id: testCase.id,
      category: testCase.category,
      description: testCase.description,
      severity: testCase.severity,
      expected: testCase.expected,
      actual: result.actual,
      passed: result.passed,
      reason: result.reason,
    };
  });
}

export function summarizeEvalOutcomes(outcomes: Array<EvalOutcome>): EvalSummary {
  const failed = outcomes.filter((outcome) => !outcome.passed);
  return {
    total: outcomes.length,
    passed: outcomes.length - failed.length,
    failed: failed.length,
    criticalFailed: failed.filter((outcome) => outcome.severity === 'critical').length,
  };
}

export function formatEvalFailures(outcomes: Array<EvalOutcome>): string {
  return outcomes
    .filter((outcome) => !outcome.passed)
    .map((outcome) => {
      const reason = outcome.reason ? ` (${outcome.reason})` : '';
      return `${outcome.id}: expected ${JSON.stringify(outcome.expected)}, got ${JSON.stringify(outcome.actual)}${reason}`;
    })
    .join('\n');
}
