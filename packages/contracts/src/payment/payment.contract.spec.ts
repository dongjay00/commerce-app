import { describe, expect, it } from 'vitest';
import { pgCallbackBodySchema, pgWebhookContract } from './payment.contract';

const VALID = {
  orderId: '018f2b1c-4a5d-7e6f-8a9b-0d1b00000001',
  pgTxId: 'pgtx-000001',
  result: 'APPROVED' as const,
};

describe('pgWebhookContract', () => {
  it('유효한 콜백을 통과시킨다', () => {
    expect(pgCallbackBodySchema.safeParse(VALID).success).toBe(true);
  });

  it('reason은 없어도 된다', () => {
    expect(pgCallbackBodySchema.safeParse({ ...VALID, reason: '한도 초과' }).success).toBe(true);
  });

  it('result가 열거값 밖이면 거부한다', () => {
    expect(pgCallbackBodySchema.safeParse({ ...VALID, result: 'MAYBE' }).success).toBe(false);
  });

  it('orderId가 uuid가 아니면 거부한다', () => {
    expect(pgCallbackBodySchema.safeParse({ ...VALID, orderId: 'nope' }).success).toBe(false);
  });

  it('pgTxId가 비면 거부한다', () => {
    expect(pgCallbackBodySchema.safeParse({ ...VALID, pgTxId: '' }).success).toBe(false);
  });

  it('모르는 필드는 거부한다', () => {
    expect(pgCallbackBodySchema.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
  });

  it('낼 수 있는 상태를 모두 선언한다', () => {
    expect(Object.keys(pgWebhookContract.callback.responses).map(Number).sort()).toEqual([
      200, 400, 404,
    ]);
  });
});
