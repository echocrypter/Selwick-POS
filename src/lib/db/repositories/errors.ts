/**
 * Selwick POS – Repository Error Definitions
 */

export class RepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[RepositoryError:${code}] ${message}`);
    this.name = 'RepositoryError';
    this.code = code;
  }
}

export class NotFoundError extends RepositoryError {
  constructor(entity: string, id: string, businessId?: string) {
    super(
      'NOT_FOUND',
      businessId
        ? `${entity} with id "${id}" was not found for business "${businessId}".`
        : `${entity} with id "${id}" was not found.`,
    );
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends RepositoryError {
  constructor(entity: string, field: string, value: string) {
    super(
      'CONFLICT',
      `${entity} with ${field} "${value}" already exists.`,
    );
    this.name = 'ConflictError';
  }
}

export class InsufficientStockError extends RepositoryError {
  readonly productId: string;
  readonly currentStock: number;
  readonly requestedDelta: number;

  constructor(productId: string, currentStock: number, requestedDelta: number) {
    super(
      'INSUFFICIENT_STOCK',
      `Product "${productId}" has insufficient stock (${currentStock}) for adjustment (${requestedDelta}). Negative stock is not permitted.`,
    );
    this.name = 'InsufficientStockError';
    this.productId = productId;
    this.currentStock = currentStock;
    this.requestedDelta = requestedDelta;
  }
}

export class ValidationError extends RepositoryError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}
