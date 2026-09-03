import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../../shared/kernel/domain-error';
import { CustomerId, OrderId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { Quantity } from '../../../../shared/kernel/quantity';
import { customerUuid, FIXED_NOW, orderUuid, skuUuid } from '../../testing/ordering.fixtures';
import { Order } from './order';
import {
  CorruptedOrderError,
  EmptyOrderError,
  MixedCurrencyOrderError,
  OrderConflictError,
  OrderNotOwnedError,
} from './order.errors';
import { ORDER_CANCELLED, ORDER_PAID, ORDER_PAYMENT_FAILED, ORDER_PLACED } from './order.events';
import { OrderLine } from './order-line';
import { ShippingAddress } from './shipping-address';

const OWNER = CustomerId.of(customerUuid('1'));
const STRANGER = CustomerId.of(customerUuid('2'));

const ADDRESS = ShippingAddress.of({
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: null,
});

const line = (suffix: string, amount: bigint, qty: number, currency: 'KRW' | 'USD' = 'KRW') =>
  OrderLine.of({
    skuId: SkuId.of(skuUuid(suffix)),
    nameSnapshot: `상품 ${suffix}`,
    unitPrice: Money.of(amount, currency),
    quantity: Quantity.positive(qty),
  });

function place(lines = [line('1', 1200n, 3), line('2', 500n, 2)]): Order {
  return Order.place({
    id: OrderId.of(orderUuid('1')),
    customerId: OWNER,
    lines,
    shippingAddress: ADDRESS,
    now: FIXED_NOW,
  });
}

describe('Order.place', () => {
  it('PENDING_PAYMENT로 시작하고 OrderPlaced를 발행한다', () => {
    const order = place();
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.pullEvents().map((e) => e.eventType)).toEqual([ORDER_PLACED]);
  });

  it('총액은 라인 소계의 합이다', () => {
    // 1200×3 + 500×2 = 4600
    expect(place().total.amount).toBe(4600n);
  });

  it('라인이 없으면 EmptyOrderError다', () => {
    expect(() => place([])).toThrow(EmptyOrderError);
  });

  it('통화가 섞이면 MixedCurrencyOrderError다', () => {
    // 편차 2. 이것이 없으면 Money.plus의 CurrencyMismatchError(평문 Error)가
    // 튀어나와 500이 나가고 사용자는 왜 실패했는지 알 수 없다.
    expect(() => place([line('1', 1000n, 1, 'KRW'), line('2', 1000n, 1, 'USD')])).toThrow(
      MixedCurrencyOrderError,
    );
  });

  it('MixedCurrencyOrderError는 DomainError다 — 500이 아니라 422다', () => {
    expect(new MixedCurrencyOrderError(['KRW', 'USD'])).toBeInstanceOf(DomainError);
  });

  it('같은 SKU가 두 줄이면 CorruptedOrderError다', () => {
    // 장바구니가 중복을 막지만(태스크 7) 주문 조립이 그것을 신뢰하지 않는다.
    expect(() => place([line('1', 1000n, 1), line('1', 2000n, 1)])).toThrow(CorruptedOrderError);
  });

  it('돌려준 lines를 바꿔도 주문은 바뀌지 않는다', () => {
    const order = place();
    (order.lines as OrderLine[]).pop();
    expect(order.lines).toHaveLength(2);
  });
});

describe('Order 상태 전이 — 결제', () => {
  it('결제되면 PAID가 되고 OrderPaid를 발행한다', () => {
    const order = place();
    order.pullEvents();

    expect(order.markPaid(FIXED_NOW)).toBe(true);

    expect(order.status).toBe('PAID');
    expect(order.pullEvents().map((e) => e.eventType)).toEqual([ORDER_PAID]);
  });

  it('두 번 결제 처리하면 false를 돌려주고 이벤트를 다시 내지 않는다', () => {
    const order = place();
    order.markPaid(FIXED_NOW);
    order.pullEvents();

    expect(order.markPaid(FIXED_NOW)).toBe(false);
    expect(order.pullEvents()).toHaveLength(0);
  });

  it('결제 실패하면 PAYMENT_FAILED가 되고 이유가 payload에 실린다', () => {
    const order = place();
    order.pullEvents();

    expect(order.failPayment('카드 한도를 초과했습니다.', FIXED_NOW)).toBe(true);

    const events = order.pullEvents();
    expect(events.map((e) => e.eventType)).toEqual([ORDER_PAYMENT_FAILED]);
    expect(events[0]?.payload).toMatchObject({ reason: '카드 한도를 초과했습니다.' });
  });

  it('두 번 실패 처리하면 false다', () => {
    const order = place();
    order.failPayment('거절', FIXED_NOW);
    order.pullEvents();

    expect(order.failPayment('거절', FIXED_NOW)).toBe(false);
    expect(order.pullEvents()).toHaveLength(0);
  });

  it('이미 결제된 주문은 실패 처리할 수 없다', () => {
    const order = place();
    order.markPaid(FIXED_NOW);
    expect(() => order.failPayment('늦은 거절', FIXED_NOW)).toThrow(OrderConflictError);
  });
});

describe('Order.cancelBy — 도메인 인가', () => {
  it('남의 주문은 상태와 무관하게 OrderNotOwnedError다', () => {
    // 스펙 §5.5: 가드가 아니라 도메인에 있다. 순서도 중요하다 — 상태 검사가
    // 먼저면 남의 주문 상태를 응답으로 유추할 수 있다.
    const order = place();
    order.markPaid(FIXED_NOW);
    expect(() => order.cancelBy(STRANGER, FIXED_NOW)).toThrow(OrderNotOwnedError);
  });

  it('OrderNotOwnedError는 DomainError다', () => {
    expect(new OrderNotOwnedError('id')).toBeInstanceOf(DomainError);
  });

  it('결제 전 취소는 CANCELLED가 되고 wasPaid가 false다', () => {
    const order = place();
    order.pullEvents();

    expect(order.cancelBy(OWNER, FIXED_NOW)).toBe(true);

    expect(order.status).toBe('CANCELLED');
    const events = order.pullEvents();
    expect(events.map((e) => e.eventType)).toEqual([ORDER_CANCELLED]);
    expect(events[0]?.payload).toMatchObject({ wasPaid: false });
  });

  it('결제 후 취소는 REFUND_PENDING이 되고 wasPaid가 true다', () => {
    // 편차 1. PAID로 남겨두면 고객에게 거짓말을 하고 취소가 멱등하지 않다.
    // wasPaid가 구독자에게 "해제"인지 "복원"인지를 알려준다.
    const order = place();
    order.markPaid(FIXED_NOW);
    order.pullEvents();

    expect(order.cancelBy(OWNER, FIXED_NOW)).toBe(true);

    expect(order.status).toBe('REFUND_PENDING');
    expect(order.pullEvents()[0]?.payload).toMatchObject({ wasPaid: true });
  });

  it('취소를 두 번 하면 false이고 이벤트가 다시 나가지 않는다', () => {
    // OrderCancelled가 at-least-once로 배달된다. 여기서 막지 못하면 환불이 두 번 요청된다.
    const order = place();
    order.markPaid(FIXED_NOW);
    order.cancelBy(OWNER, FIXED_NOW);
    order.pullEvents();

    expect(order.cancelBy(OWNER, FIXED_NOW)).toBe(false);
    expect(order.pullEvents()).toHaveLength(0);
  });

  it('결제 실패한 주문은 취소할 수 없다', () => {
    // 이미 끝난 주문이다. false로 넘기면 클라이언트가 "취소했다"고 표시하는데
    // 실제로는 애초에 실패한 주문이다.
    const order = place();
    order.failPayment('거절', FIXED_NOW);
    expect(() => order.cancelBy(OWNER, FIXED_NOW)).toThrow(OrderConflictError);
  });
});

describe('Order.markRefunded', () => {
  it('REFUND_PENDING에서만 REFUNDED가 된다', () => {
    const order = place();
    order.markPaid(FIXED_NOW);
    order.cancelBy(OWNER, FIXED_NOW);
    order.pullEvents();

    expect(order.markRefunded(FIXED_NOW)).toBe(true);
    expect(order.status).toBe('REFUNDED');
    // 구독자가 없는 이벤트는 발행하지 않는다.
    expect(order.pullEvents()).toHaveLength(0);
  });

  it('PAID 상태에서 환불 완료가 오면 충돌이다', () => {
    // 취소 요청 없이 환불 완료가 왔다는 것은 사가가 순서를 잃었다는 뜻이다.
    const order = place();
    order.markPaid(FIXED_NOW);
    expect(() => order.markRefunded(FIXED_NOW)).toThrow(OrderConflictError);
  });

  it('두 번 오면 false다', () => {
    // PaymentRefunded도 at-least-once로 배달된다.
    const order = place();
    order.markPaid(FIXED_NOW);
    order.cancelBy(OWNER, FIXED_NOW);
    order.markRefunded(FIXED_NOW);

    expect(order.markRefunded(FIXED_NOW)).toBe(false);
  });
});

describe('Order.assertOwnedBy', () => {
  it('본인이면 통과한다', () => {
    expect(() => place().assertOwnedBy(OWNER)).not.toThrow();
  });

  it('남이면 OrderNotOwnedError다', () => {
    // 조회에도 같은 규칙이 필요하다 — 태스크 14의 GetOrder가 쓴다.
    expect(() => place().assertOwnedBy(STRANGER)).toThrow(OrderNotOwnedError);
  });
});

describe('Order.rehydrate', () => {
  const rehydrate = (overrides: { status?: string; total?: Money; lines?: OrderLine[] }) =>
    Order.rehydrate({
      id: OrderId.fromPersistence(orderUuid('9')),
      customerId: CustomerId.fromPersistence(customerUuid('1')),
      status: overrides.status ?? 'PAID',
      lines: overrides.lines ?? [line('1', 1000n, 2)],
      shippingAddress: ADDRESS,
      total: overrides.total ?? Money.of(2000n),
      placedAt: FIXED_NOW,
    });

  it('알 수 없는 상태는 CorruptedOrderError다', () => {
    expect(() => rehydrate({ status: 'WEIRD' })).toThrow(CorruptedOrderError);
  });

  it('라인이 없으면 CorruptedOrderError다', () => {
    expect(() => rehydrate({ lines: [] })).toThrow(CorruptedOrderError);
  });

  it('저장된 총액이 라인 합과 다르면 CorruptedOrderError다', () => {
    // 스펙 §5.1의 불변식 "합계 = Σ(단가×수량)". 어긋난 채 읽어들이면 그 주문은
    // 영원히 틀린 금액을 보여준다 — 소리 나게 실패하는 편이 낫다.
    expect(() => rehydrate({ total: Money.of(9999n) })).toThrow(CorruptedOrderError);
  });

  it('CorruptedOrderError는 DomainError가 아니다', () => {
    expect(new CorruptedOrderError('id', 'detail')).not.toBeInstanceOf(DomainError);
  });

  it('복원된 주문은 이벤트를 갖지 않는다', () => {
    // 읽어들인 것만으로 이벤트가 생기면 저장할 때마다 outbox에 중복이 쌓인다.
    expect(rehydrate({}).hasUncommittedEvents).toBe(false);
  });
});
