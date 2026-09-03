import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { OrderId, PaymentId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import { attemptUuid, FIXED_NOW, orderUuid, paymentUuid } from '../testing/payment.fixtures';
import { Payment } from './payment';
import { CorruptedPaymentError, PaymentConflictError } from './payment.errors';
import { PAYMENT_REFUNDED } from './payment.events';
import { PaymentAttempt } from './payment-attempt';

const AMOUNT = Money.of(12_000n);

function open(): Payment {
  return Payment.open({
    id: PaymentId.of(paymentUuid('1')),
    orderId: OrderId.of(orderUuid('1')),
    amount: AMOUNT,
    now: FIXED_NOW,
  });
}

const attempt = (result: 'APPROVED' | 'DECLINED', suffix = '1'): PaymentAttempt =>
  new PaymentAttempt(attemptUuid(suffix), `pg-tx-${suffix}`, result, null, FIXED_NOW);

describe('Payment.open', () => {
  it('PENDING 상태로 열리고 시도가 없다', () => {
    const payment = open();
    expect(payment.status).toBe('PENDING');
    expect(payment.attempts).toHaveLength(0);
  });

  it('금액이 0 이하면 열 수 없다', () => {
    // 0원 결제는 결제가 아니다. 여기까지 왔다면 주문 총계 계산이 깨진 것이다.
    expect(() =>
      Payment.open({
        id: PaymentId.of(paymentUuid('2')),
        orderId: OrderId.of(orderUuid('2')),
        amount: Money.zero(),
        now: FIXED_NOW,
      }),
    ).toThrow(/0보다 커야/);
  });
});

describe('Payment 전이', () => {
  it('승인하면 AUTHORIZED가 되고 시도가 쌓인다', () => {
    const payment = open();
    expect(payment.authorize(attempt('APPROVED'))).toBe(true);
    expect(payment.status).toBe('AUTHORIZED');
    expect(payment.attempts).toHaveLength(1);
  });

  it('같은 승인을 두 번 하면 false를 돌려주고 시도가 늘지 않는다', () => {
    // OrderCancelled와 마찬가지로 at-least-once 배달이 재호출을 만든다.
    const payment = open();
    const first = attempt('APPROVED');
    expect(payment.authorize(first)).toBe(true);
    expect(payment.authorize(first)).toBe(false);
    expect(payment.attempts).toHaveLength(1);
  });

  it('거절하면 DECLINED가 된다', () => {
    const payment = open();
    expect(payment.decline(attempt('DECLINED'))).toBe(true);
    expect(payment.status).toBe('DECLINED');
  });

  it('거절된 결제를 승인할 수 없다', () => {
    const payment = open();
    payment.decline(attempt('DECLINED'));
    expect(() => payment.authorize(attempt('APPROVED', '2'))).toThrow(PaymentConflictError);
  });

  it('승인된 결제를 환불하면 REFUNDED가 되고 PaymentRefunded를 발행한다', () => {
    const payment = open();
    payment.authorize(attempt('APPROVED'));
    payment.pullEvents();

    expect(payment.refund(FIXED_NOW)).toBe(true);

    expect(payment.status).toBe('REFUNDED');
    const events = payment.pullEvents();
    expect(events.map((e) => e.eventType)).toEqual([PAYMENT_REFUNDED]);
    expect(events[0]?.payload).toMatchObject({ amount: '12000', currency: 'KRW' });
  });

  it('환불을 두 번 하면 false를 돌려주고 이벤트를 다시 발행하지 않는다', () => {
    // 이것이 편차 5(SKIP LOCKED를 넣지 않는다)를 갚는 자리다.
    const payment = open();
    payment.authorize(attempt('APPROVED'));
    payment.refund(FIXED_NOW);
    payment.pullEvents();

    expect(payment.refund(FIXED_NOW)).toBe(false);
    expect(payment.pullEvents()).toHaveLength(0);
  });

  it('승인되지 않은 결제는 환불할 수 없다', () => {
    // 조용히 넘기면 사가가 순서를 잃었다는 사실이 영영 드러나지 않는다.
    expect(() => open().refund(FIXED_NOW)).toThrow(PaymentConflictError);
  });

  it('PaymentConflictError는 DomainError다', () => {
    expect(new PaymentConflictError('id', 'PENDING', 'REFUNDED')).toBeInstanceOf(DomainError);
  });
});

describe('Payment.recordCallback — 웹훅 정합', () => {
  it('처음 보는 pgTxId면 시도를 남기고 true를 돌려준다', () => {
    const payment = open();
    expect(payment.recordCallback(attempt('APPROVED'))).toBe(true);
    expect(payment.attempts).toHaveLength(1);
  });

  it('이미 기록된 pgTxId면 false를 돌려주고 아무것도 바꾸지 않는다', () => {
    // 스펙 §7.6의 "웹훅, 멱등". DB의 유니크 제약과 이중으로 건다.
    const payment = open();
    const callback = attempt('APPROVED');
    payment.recordCallback(callback);
    expect(payment.recordCallback(callback)).toBe(false);
    expect(payment.attempts).toHaveLength(1);
  });

  it('PENDING 상태에서 승인 콜백을 받으면 AUTHORIZED로 정합된다', () => {
    const payment = open();
    payment.recordCallback(attempt('APPROVED'));
    expect(payment.status).toBe('AUTHORIZED');
  });

  it('PENDING 상태에서 거절 콜백을 받으면 DECLINED로 정합된다', () => {
    const payment = open();
    payment.recordCallback(attempt('DECLINED'));
    expect(payment.status).toBe('DECLINED');
  });

  it('이미 REFUNDED면 늦게 온 승인 콜백이 상태를 되돌리지 않는다', () => {
    // 늦게 도착한 콜백이 환불된 결제를 되살리면 돈이 사라진다.
    const payment = open();
    payment.authorize(attempt('APPROVED'));
    payment.refund(FIXED_NOW);

    expect(payment.recordCallback(attempt('APPROVED', '2'))).toBe(true);

    expect(payment.status).toBe('REFUNDED');
    expect(payment.attempts).toHaveLength(2);
  });
});

describe('Payment.attempts 캡슐화', () => {
  it('돌려준 배열을 바꿔도 결제는 바뀌지 않는다', () => {
    const payment = open();
    payment.authorize(attempt('APPROVED'));

    (payment.attempts as PaymentAttempt[]).push(attempt('DECLINED', '9'));

    expect(payment.attempts).toHaveLength(1);
  });
});

describe('Payment.rehydrate', () => {
  it('알 수 없는 상태는 CorruptedPaymentError다', () => {
    // 저장된 행이 깨진 것이므로 500이다. DomainError가 아니다.
    expect(() =>
      Payment.rehydrate({
        id: PaymentId.of(paymentUuid('9')),
        orderId: OrderId.of(orderUuid('9')),
        amount: AMOUNT,
        status: 'WEIRD',
        attempts: [],
      }),
    ).toThrow(CorruptedPaymentError);
  });

  it('CorruptedPaymentError는 DomainError가 아니다', () => {
    expect(new CorruptedPaymentError('id', 'WEIRD')).not.toBeInstanceOf(DomainError);
  });

  it('복원된 결제는 이벤트를 갖지 않는다', () => {
    const payment = Payment.rehydrate({
      id: PaymentId.of(paymentUuid('9')),
      orderId: OrderId.of(orderUuid('9')),
      amount: AMOUNT,
      status: 'REFUNDED',
      attempts: [],
    });
    expect(payment.hasUncommittedEvents).toBe(false);
  });
});
