/**
 * Selwick POS – Structured POS Errors
 */

export class PosError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(`[PosError:${code}] ${message}`);
    this.name = 'PosError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InsufficientStockError extends PosError {
  constructor(productId: string, currentStock: number, requested: number) {
    super(
      'INSUFFICIENT_STOCK',
      `Product "${productId}" has insufficient stock (${currentStock}) for requested quantity (${requested}).`,
      409,
      { productId, currentStock, requested }
    );
    this.name = 'InsufficientStockError';
  }
}

export class IdempotencyConflictError extends PosError {
  constructor(key: string, reason = 'Payload mismatch') {
    super(
      'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
      `Idempotency key "${key}" has already been used with a different request payload (${reason}).`,
      409,
      { idempotencyKey: key, reason }
    );
    this.name = 'IdempotencyConflictError';
  }
}

export class DuplicateRefundError extends PosError {
  constructor(saleId: string, invoiceNumber: string) {
    super(
      'DUPLICATE_REFUND',
      `Sale "${invoiceNumber}" (${saleId}) has already been refunded.`,
      409,
      { saleId, invoiceNumber }
    );
    this.name = 'DuplicateRefundError';
  }
}

export class PosValidationError extends PosError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'PosValidationError';
  }
}

export class PosNotFoundError extends PosError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} "${id}" not found.`, 404, { entity, id });
    this.name = 'PosNotFoundError';
  }
}
