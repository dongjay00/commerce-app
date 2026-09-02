import { ErrorCode } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { DomainErrorRegistry } from './domain-error.registry';

describe('DomainErrorRegistry', () => {
  it('등록한 매핑을 돌려준다', () => {
    const registry = new DomainErrorRegistry();
    registry.register('INSUFFICIENT_STOCK', {
      status: 409,
      code: ErrorCode.INSUFFICIENT_STOCK,
    });

    expect(registry.resolve('INSUFFICIENT_STOCK')).toEqual({
      status: 409,
      code: ErrorCode.INSUFFICIENT_STOCK,
    });
  });

  it('등록되지 않은 도메인 예외는 422 DOMAIN_RULE_VIOLATED로 처리한다', () => {
    expect(new DomainErrorRegistry().resolve('UNKNOWN_CODE')).toEqual({
      status: 422,
      code: ErrorCode.DOMAIN_RULE_VIOLATED,
    });
  });

  it('같은 코드를 두 번 등록하면 거부한다 — 조용한 덮어쓰기를 막는다', () => {
    const registry = new DomainErrorRegistry();
    registry.register('SOME_ERROR', { status: 409, code: ErrorCode.INSUFFICIENT_STOCK });

    expect(() =>
      registry.register('SOME_ERROR', { status: 422, code: ErrorCode.PAYMENT_DECLINED }),
    ).toThrow('SOME_ERROR');
  });

  it('여러 예외를 독립적으로 등록한다', () => {
    const registry = new DomainErrorRegistry();
    registry.register('A', { status: 409, code: ErrorCode.INSUFFICIENT_STOCK });
    registry.register('B', { status: 422, code: ErrorCode.PAYMENT_DECLINED });

    expect(registry.resolve('A').status).toBe(409);
    expect(registry.resolve('B').status).toBe(422);
  });
});
