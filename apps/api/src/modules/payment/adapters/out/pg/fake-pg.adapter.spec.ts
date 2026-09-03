import { describe, expect, it } from 'vitest';
import { OrderId } from '../../../../../shared/kernel/identifiers';
import { Money } from '../../../../../shared/kernel/money';
import { orderUuid } from '../../../testing/payment.fixtures';
import { FakePgAdapter, PgTimeoutError } from './fake-pg.adapter';

const charge = (adapter: FakePgAdapter) =>
  adapter.charge({ orderId: OrderId.of(orderUuid('1')), amount: Money.of(1000n) });

describe('FakePgAdapter', () => {
  it('기본 시나리오는 승인이다', async () => {
    const result = await charge(new FakePgAdapter());
    expect(result.outcome).toBe('APPROVED');
  });

  it('DECLINE이면 이유와 함께 거절한다', async () => {
    const adapter = new FakePgAdapter();
    adapter.scenario = 'DECLINE';
    const result = await charge(adapter);
    expect(result).toEqual({
      outcome: 'DECLINED',
      pgTxId: 'pgtx-000001',
      reason: expect.any(String),
    });
  });

  it('TIMEOUT이면 던진다 — 결과가 아니라 오류다', async () => {
    const adapter = new FakePgAdapter();
    adapter.scenario = 'TIMEOUT';
    await expect(charge(adapter)).rejects.toThrow(PgTimeoutError);
  });

  it('pgTxId가 호출마다 다르다', async () => {
    // 같은 값이 나오면 payment_attempts.pg_tx_id 유니크에 걸려 두 번째 결제가 못 들어간다.
    const adapter = new FakePgAdapter();
    const first = await charge(adapter);
    const second = await charge(adapter);
    expect(first.pgTxId).not.toBe(second.pgTxId);
  });

  it('같은 거래를 두 번 환불해도 조용히 성공한다', async () => {
    const adapter = new FakePgAdapter();
    await adapter.refund({ pgTxId: 'pgtx-000001' });
    await adapter.refund({ pgTxId: 'pgtx-000001' });
    expect(adapter.refundedTxIds).toEqual(['pgtx-000001']);
  });

  it('refundedTxIds를 바꿔도 내부 상태는 바뀌지 않는다', async () => {
    const adapter = new FakePgAdapter();
    await adapter.refund({ pgTxId: 'pgtx-000001' });
    (adapter.refundedTxIds as string[]).push('spoofed');
    expect(adapter.refundedTxIds).toEqual(['pgtx-000001']);
  });
});
