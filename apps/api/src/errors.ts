export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTENT_NOT_ACTIONABLE'
  | 'INTENT_EXPIRED'
  | 'CHAIN_UNAVAILABLE'
  | 'KILL_SWITCH_ENGAGED'
  | 'INTERNAL_ERROR';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTENT_NOT_ACTIONABLE: 422,
  INTENT_EXPIRED: 409,
  CHAIN_UNAVAILABLE: 503,
  KILL_SWITCH_ENGAGED: 423,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    if (details !== undefined) this.details = details;
  }
}