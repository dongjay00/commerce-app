import { describe, expect, it } from 'vitest';
import { OrderId } from '../../../../shared/kernel/identifiers';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import {
  PaymentAmountMismatchError,
  PaymentConflictError,
  PaymentNotFoundError,
} from '../../domain/payment.errors';
import { PAYMENT_REFUNDED } from '../../domain/payment.events';
import { InMemoryPaymentRepository } from '../../testing/in-memory-payment.repository';
import { FIXED_NOW, orderUuid } from '../../testing/payment.fixtures';
import type { PgClient, PgResult } from '../ports/out/pg-client';
import { PaymentService } from './payment.service';

const ORDER = orderUuid('1');

class PgStubTimeoutError extends Error {}

/**
 * 손으로 쓴 `PgClient` 스텁. **`FakePgAdapter`를 쓰지 않는다** — 그것은
 * `adapters/out/pg/`에 있고, application 계층은 포트만 알아야 한다
 * (`noRestrictedImports`가 강제한다). 이 규칙이 실제로 이 파일을 잡았다.
 *
 * 어댑터와 로직이 비슷하지만 목적이 다르다: 어댑터는 "개발·E2E에서 그럴듯한 PG"이고,
 * 이 스텁은 "서비스의 입력을 통제하는 장치"다.
 */
class PgStub implements PgClient {
  scenario: 'APPROVE' | 'DECLINE' | 'TIMEOUT' = 'APPROVE';
  readonly refunded: string[] = [];

  private sequence = 0;

  async charge(): Promise<PgResult> {
    this.sequence += 1;
    const pgTxId = `pgtx-${this.sequence}`;
    if (this.scenario === 'TIMEOUT') {
      throw new PgStubTimeoutError('PG 응답 시간이 초과되었습니다.');
    }
    if (this.scenario === 'DECLINE') {
      return { outcome: 'DECLINED', pgTxId, reason: '카드 한도를 초과했습니다.' };
    }
    return { outcome: 'APPROVED', pgTxId };
  }

  async refund(params: { pgTxId: string }): Promise<void> {
    this.refunded.push(params.pgTxId);
  }
}

function build() {
  const payments = new InMemoryPaymentRepository();
  const pg = new PgStub();
  const events = new RecordingEventPublisher();
  const service = new PaymentService(
    payments,
    pg,
    events,
    new PassthroughTransactionManager(),
    new MutableClock(FIXED_NOW),
    new SequentialIdGenerator(),
  );
  return { service, payments, pg, events };
}

const authorize = (service: PaymentService, orderId = ORDER) =>
  service.execute({ orderId, amount: '12000', currency: 'KRW' });

describe('AuthorizePayment', () => {
  it('승인되면 ok: true와 pgTxId를 돌려주고 결제가 AUTHORIZED로 남는다', async () => {
    const { service, payments } = build();

    const result = await authorize(service);

    expect(result.ok).toBe(true);
    const saved = await payments.findByOrderId(OrderId.of(ORDER));
    expect(saved?.status).toBe('AUTHORIZED');
    expect(saved?.attempts).toHaveLength(1);
  });

  it('거절되면 ok: false를 돌려준다 — 예외가 아니다', async () => {
    // 사가의 4a/4b 갈림길이다(스펙 §6.2). 예외로 만들면 PlaceOrderService가
    // 정상 분기를 catch에서 처리하게 되고 진짜 오류와 구분이 사라진다.
    const { service, pg, payments } = build();
    pg.scenario = 'DECLINE';

    const result = await authorize(service);

    expect(result).toEqual({ ok: false, reason: expect.any(String) });
    expect((await payments.findByOrderId(OrderId.of(ORDER)))?.status).toBe('DECLINED');
  });

  it('PG가 타임아웃하면 던진다', async () => {
    const { service, pg } = build();
    pg.scenario = 'TIMEOUT';
    await expect(authorize(service)).rejects.toThrow(PgStubTimeoutError);
  });

  it('타임아웃해도 결제 행은 PENDING으로 남는다', async () => {
    // 결제 여부를 모르는 상태다. 지워버리면 나중에 PG 정산에서 발견된 승인을
    // 붙일 곳이 없어진다 — 웹훅이 정합시킬 대상이 이 행이다.
    const { service, pg, payments } = build();
    pg.scenario = 'TIMEOUT';
    await authorize(service).catch(() => undefined);

    expect((await payments.findByOrderId(OrderId.of(ORDER)))?.status).toBe('PENDING');
  });

  it('같은 주문을 두 번 승인 요청하면 기존 결제를 재사용한다', async () => {
    // payments.order_id가 유니크다. 새로 열면 P2002로 죽는다.
    const { service, payments } = build();
    await authorize(service);
    const first = await payments.findByOrderId(OrderId.of(ORDER));

    const second = await authorize(service);

    expect(second.ok).toBe(true);
    expect((second as { paymentId: string }).paymentId).toBe(first?.id);
  });

  it('같은 주문을 다른 금액으로 재요청하면 PaymentAmountMismatchError다', async () => {
    // 스펙 §5.1의 payment 불변식 "승인액 = 주문 금액". 조용히 기존 결제를 재사용하면
    // 주문 금액과 다른 액수가 승인된 채 남고, 그 불일치는 정산에서야 드러난다.
    // 사용자가 고칠 수 있는 것이 없으므로 DomainError가 아니라 500이다.
    const { service } = build();
    await authorize(service);

    await expect(
      service.execute({ orderId: ORDER, amount: '99000', currency: 'KRW' }),
    ).rejects.toThrow(PaymentAmountMismatchError);
  });
});

describe('RefundPayment', () => {
  it('승인된 결제를 환불하면 true를 돌려주고 PaymentRefunded를 발행한다', async () => {
    const { service, pg, events } = build();
    await authorize(service);

    expect(await service.refund({ orderId: ORDER })).toBe(true);

    expect(events.published.map((e) => e.eventType)).toContain(PAYMENT_REFUNDED);
    expect(pg.refunded).toHaveLength(1);
  });

  it('두 번 환불하면 두 번째는 false이고 PG를 다시 부르지 않는다', async () => {
    // OrderCancelled가 at-least-once로 배달된다. 여기서 막지 못하면 돈이 두 번 나간다.
    const { service, pg } = build();
    await authorize(service);
    await service.refund({ orderId: ORDER });

    expect(await service.refund({ orderId: ORDER })).toBe(false);
    expect(pg.refunded).toHaveLength(1);
  });

  it('없는 주문을 환불하면 PaymentNotFoundError다', async () => {
    const { service } = build();
    await expect(service.refund({ orderId: orderUuid('9') })).rejects.toThrow(PaymentNotFoundError);
  });

  it('거절된 결제는 환불할 수 없다', async () => {
    const { service, pg } = build();
    pg.scenario = 'DECLINE';
    await authorize(service);

    await expect(service.refund({ orderId: ORDER })).rejects.toThrow(PaymentConflictError);
  });
});

describe('HandlePgCallback', () => {
  it('처음 보는 콜백이면 true를 돌려주고 시도를 남긴다', async () => {
    const { service, payments } = build();
    await authorize(service);

    const handled = await service.handleCallback({
      orderId: ORDER,
      pgTxId: 'late-tx-1',
      result: 'APPROVED',
    });

    expect(handled).toBe(true);
    expect((await payments.findByOrderId(OrderId.of(ORDER)))?.attempts).toHaveLength(2);
  });

  it('같은 pgTxId가 두 번 오면 두 번째는 false다', async () => {
    // 스펙 §7.6의 "웹훅, 멱등".
    const { service, payments } = build();
    await authorize(service);
    const callback = { orderId: ORDER, pgTxId: 'late-tx-1', result: 'APPROVED' as const };
    await service.handleCallback(callback);

    expect(await service.handleCallback(callback)).toBe(false);
    expect((await payments.findByOrderId(OrderId.of(ORDER)))?.attempts).toHaveLength(2);
  });

  it('결제가 없는 주문의 콜백은 PaymentNotFoundError다', async () => {
    const { service } = build();
    await expect(
      service.handleCallback({ orderId: orderUuid('9'), pgTxId: 'x', result: 'APPROVED' }),
    ).rejects.toThrow(PaymentNotFoundError);
  });
});
