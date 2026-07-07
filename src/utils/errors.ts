/**
 * Application error carrying an HTTP status code, so controllers can throw domain
 * errors and the central error handler can translate them into responses.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly details?: string;

  constructor(statusCode: number, message: string, details?: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: string) {
    super(400, message, details);
    this.name = "BadRequestError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, details?: string) {
    super(502, message, details);
    this.name = "UpstreamError";
  }
}
