export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'MEDIA_PROCESSING_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  MEDIA_PROCESSING_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError('VALIDATION_FAILED', message, details);
export const unauthenticated = (message = '请先登录') => new AppError('UNAUTHENTICATED', message);
export const forbidden = (message = '没有权限执行该操作') => new AppError('FORBIDDEN', message);
/** 无权访问的资源一律返回 404，避免通过状态码枚举出资源是否存在 */
export const notFound = (message = '资源不存在') => new AppError('NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) => new AppError('CONFLICT', message, details);

