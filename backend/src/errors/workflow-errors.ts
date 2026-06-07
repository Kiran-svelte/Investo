/**
 * @file workflow-errors.ts
 * @description Typed domain error classes for the Investo workflow engine.
 *
 * All errors extend `InvestoError` which carries a machine-readable `code`,
 * an optional `companyId` for tenant scoping, and an optional `requestId`
 * for distributed tracing correlation.
 *
 * Rule: none of these errors expose internal file paths, SQL, or service names.
 * The `message` field is safe to log; never forward it to clients.
 */

/**
 * Base class for all domain errors in Investo.
 * Guarantees every thrown error has a `code` and `isInvestoError` discriminant.
 *
 * @param message - Human-readable error description (safe for logs, not for clients).
 * @param code - Machine-readable error code (e.g. 'WORKFLOW_IDEMPOTENCY_UNAVAILABLE').
 * @param companyId - Optional tenant scope for log correlation.
 * @param requestId - Optional distributed trace / request ID.
 */
export class InvestoError extends Error {
  readonly isInvestoError = true as const;
  readonly code: string;
  readonly companyId?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    code: string,
    options?: { companyId?: string; requestId?: string },
  ) {
    super(message);
    this.name = 'InvestoError';
    this.code = code;
    this.companyId = options?.companyId;
    this.requestId = options?.requestId;
    // Preserve prototype chain in transpiled output.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the workflow idempotency DB model (`workflowIdempotencyKey`) is
 * not available in the Prisma client — typically because the migration has not
 * yet run in the target environment.
 *
 * This is an **unrecoverable** configuration error. The caller must fail fast
 * and alert on-call rather than silently proceeding without dedup guarantees.
 *
 * @param companyId - Tenant scope for log correlation.
 * @param workflowId - The workflow that triggered the check.
 */
export class WorkflowIdempotencyError extends InvestoError {
  readonly workflowId: string;

  constructor(companyId: string, workflowId: string) {
    super(
      `Workflow idempotency DB model unavailable for workflow "${workflowId}". ` +
        'Ensure the database migration for WorkflowIdempotencyKey has been applied.',
      'WORKFLOW_IDEMPOTENCY_UNAVAILABLE',
      { companyId },
    );
    this.name = 'WorkflowIdempotencyError';
    this.workflowId = workflowId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a saga compensator step itself fails, leaving the system in a
 * partially-compensated state that requires manual reconciliation.
 *
 * The `failedStep` field identifies which compensator action did not complete.
 * The `workflowRunId` links back to the `workflow_run_records` row.
 *
 * @param workflowRunId - UUID of the failed workflow run.
 * @param failedStep - Name of the compensator action that errored.
 * @param companyId - Tenant scope for log correlation.
 */
export class WorkflowCompensationError extends InvestoError {
  readonly workflowRunId: string;
  readonly failedStep: string;

  constructor(workflowRunId: string, failedStep: string, companyId: string) {
    super(
      `Workflow compensation failed at step "${failedStep}" for run "${workflowRunId}". ` +
        'Manual reconciliation required.',
      'WORKFLOW_COMPENSATION_FAILED',
      { companyId },
    );
    this.name = 'WorkflowCompensationError';
    this.workflowRunId = workflowRunId;
    this.failedStep = failedStep;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Returns true when the given error is an `InvestoError` instance.
 * Useful for narrowing `unknown` catch blocks without importing every subclass.
 *
 * @param err - Any caught value.
 */
export function isInvestoError(err: unknown): err is InvestoError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as InvestoError).isInvestoError === true
  );
}
