import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Validate request body against a Zod schema.
 * Returns 400 with detailed errors if validation fails.
 * Includes the request correlation ID in the error response for log tracing.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const requestId = (req as any).requestId as string | undefined;
        const details = err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));

        res.status(400).json({
          error: details[0]?.message || 'Validation failed',
          details,
          requestId,
        });
        return;
      }
      next(err);
    }
  };
}
