import {
  buttonPolicyEvalCases,
  buyerRoutingEvalCases,
  classifyBuyerRoute,
  evaluateButtonPolicy,
  evaluateResponseSafety,
  evaluateStaffCopilot,
  formatEvalFailures,
  responseSafetyEvalCases,
  runEvalCases,
  staffCopilotEvalCases,
  outboundBudgetEvalCases,
  evaluateOutboundBudget,
  summarizeEvalOutcomes,
} from '../../evals';

describe('Investo eval suite', () => {
  it('buyer routing evals pass', () => {
    const outcomes = runEvalCases(buyerRoutingEvalCases, (testCase) => {
      const actual = { route: classifyBuyerRoute(testCase.input) };
      return {
        actual,
        passed: actual.route === testCase.expected.route,
        reason: `route=${actual.route}`,
      };
    });

    expect(formatEvalFailures(outcomes)).toBe('');
    expect(summarizeEvalOutcomes(outcomes)).toMatchObject({
      failed: 0,
      criticalFailed: 0,
    });
  });

  it('buyer response safety evals pass', () => {
    const outcomes = runEvalCases(responseSafetyEvalCases, (testCase) => {
      const actual = evaluateResponseSafety(testCase.input);
      return {
        actual,
        passed: actual.violations.length === 0,
        reason: actual.violations.join(', '),
      };
    });

    expect(formatEvalFailures(outcomes)).toBe('');
    expect(summarizeEvalOutcomes(outcomes)).toMatchObject({
      failed: 0,
      criticalFailed: 0,
    });
  });

  it('buyer button policy evals pass', () => {
    const outcomes = runEvalCases(buttonPolicyEvalCases, (testCase) => {
      const actual = evaluateButtonPolicy(testCase.input);
      const expected = testCase.expected;
      const hasExpectedButtons = expected.buttonIds
        ? expected.buttonIds.every((id) => actual.buttonIds.includes(id))
        : true;
      const hasForbiddenButtons = expected.forbiddenButtonIds
        ? expected.forbiddenButtonIds.some((id) => actual.buttonIds.includes(id))
        : false;
      const noButtonsSatisfied = expected.noButtons ? actual.buttonIds.length === 0 : true;
      const passed = hasExpectedButtons && !hasForbiddenButtons && noButtonsSatisfied;

      return {
        actual,
        passed,
        reason: `buttons=${actual.buttonIds.join(',')}`,
      };
    });

    expect(formatEvalFailures(outcomes)).toBe('');
    expect(summarizeEvalOutcomes(outcomes)).toMatchObject({
      failed: 0,
      criticalFailed: 0,
    });
  });

  it('outbound budget evals pass', () => {
    const outcomes = runEvalCases(outboundBudgetEvalCases, (testCase) => {
      const actual = evaluateOutboundBudget(testCase.input);
      const expected = testCase.expected;
      const passed =
        actual.interactiveCount <= expected.maxInteractive &&
        actual.mediaCount <= expected.maxMedia &&
        actual.total <= expected.maxTotal;

      return {
        actual,
        passed,
        reason: `interactive=${actual.interactiveCount}; media=${actual.mediaCount}; total=${actual.total}`,
      };
    });

    expect(formatEvalFailures(outcomes)).toBe('');
    expect(summarizeEvalOutcomes(outcomes)).toMatchObject({
      failed: 0,
      criticalFailed: 0,
    });
  });

  it('staff copilot evals pass', () => {
    const outcomes = runEvalCases(staffCopilotEvalCases, (testCase) => {
      const actual = evaluateStaffCopilot(testCase.input);
      const expected = testCase.expected;
      const commandSatisfied = expected.command ? actual.command === expected.command : true;
      const buttonsSatisfied = expected.buttonIds
        ? expected.buttonIds.every((id) => actual.buttonIds?.includes(id))
        : true;
      const noButtonsSatisfied = expected.noButtons ? (actual.buttonIds ?? []).length === 0 : true;

      return {
        actual,
        passed: commandSatisfied && buttonsSatisfied && noButtonsSatisfied,
        reason: `command=${actual.command ?? ''}; buttons=${actual.buttonIds?.join(',') ?? ''}`,
      };
    });

    expect(formatEvalFailures(outcomes)).toBe('');
    expect(summarizeEvalOutcomes(outcomes)).toMatchObject({
      failed: 0,
      criticalFailed: 0,
    });
  });
});
