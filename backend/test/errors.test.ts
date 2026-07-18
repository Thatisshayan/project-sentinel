import {
  AppError,
  DbError,
  AICallError,
  ValidationError,
  WebhookError,
  ConfigError,
  NotFoundError,
} from '../src/errors/errors';

describe('AppError taxonomy', () => {
  it('AppError sets code, httpStatus, isOperational defaults', () => {
    const e = new AppError('boom', 'TEST_ERROR');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('TEST_ERROR');
    expect(e.httpStatus).toBe(500);
    expect(e.isOperational).toBe(true);
    expect(e.name).toBe('AppError');
    expect(e.stack).toBeDefined();
  });

  it('AppError honours operational=false for programmer errors', () => {
    const e = new AppError('bad', 'BAD', 500, false);
    expect(e.isOperational).toBe(false);
  });

  it('DbError maps to 503 and DB_ERROR code', () => {
    const e = new DbError('down');
    expect(e).toBeInstanceOf(AppError);
    expect(e.httpStatus).toBe(503);
    expect(e.code).toBe('DB_ERROR');
    expect(e.isOperational).toBe(true);
  });

  it('AICallError builds provider-prefixed code + 502', () => {
    const e = new AICallError('timeout', 'gemini');
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe('AI_GEMINI_ERROR');
    expect(e.httpStatus).toBe(502);
    expect(e.provider).toBe('gemini');
  });

  it('ValidationError is 400', () => {
    const e = new ValidationError('missing field');
    expect(e.httpStatus).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
  });

  it('WebhookError is 401', () => {
    const e = new WebhookError('bad sig');
    expect(e.httpStatus).toBe(401);
    expect(e.code).toBe('WEBHOOK_ERROR');
  });

  it('ConfigError is non-operational 500 with config code', () => {
    const e = new ConfigError('DATABASE_URL');
    expect(e.httpStatus).toBe(500);
    expect(e.isOperational).toBe(false);
    expect(e.code).toBe('CONFIG_ERROR');
    expect(e.message).toContain('DATABASE_URL');
  });

  it('NotFoundError is 404', () => {
    const e = new NotFoundError('repo');
    expect(e.httpStatus).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
  });
});
