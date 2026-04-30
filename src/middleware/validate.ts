import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Generic Zod validation middleware factory.
 * Parses req.body against the given schema.
 * Returns clean 400 errors with field-level messages on failure.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Parse and replace req.body with the validated + typed data
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const fieldErrors = error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));

        console.warn(`[Validation Failed] ${req.method} ${req.path}:`, JSON.stringify(fieldErrors));

        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: fieldErrors,
        });
        return;
      }

      // Unexpected error — pass to global error handler
      next(error);
    }
  };
}
