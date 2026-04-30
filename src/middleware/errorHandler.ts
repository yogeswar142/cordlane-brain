import { Request, Response, NextFunction } from 'express';

/**
 * Centralized error handling middleware.
 * Must be registered LAST in the Express middleware chain.
 * Catches all unhandled errors from controllers and middleware.
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const timestamp = new Date().toISOString();
  const isDev = process.env.NODE_ENV !== 'production';

  // Handle specific error types for better debugging
  let statusCode = 500;
  let message = err.message || 'Internal server error';
  let errorCode = 'INTERNAL_ERROR';

  if (err.type === 'entity.too.large' || err.status === 413) {
    statusCode = 413;
    message = 'Request entity too large. If you are sending a large batch, try reducing the batch size or check the 10mb limit.';
    errorCode = 'PAYLOAD_TOO_LARGE';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
  }

  console.error(`[${timestamp}] ❌ ${errorCode}:`, {
    method: req.method,
    path: req.path,
    message: err.message,
    status: statusCode,
    contentLength: req.get('content-length'),
    ...(isDev && { stack: err.stack }),
  });

  res.status(statusCode).json({
    success: false,
    error: isDev ? message : (statusCode === 500 ? 'Internal server error' : message),
    code: errorCode,
    ...(isDev && { stack: err.stack }),
  });
}
