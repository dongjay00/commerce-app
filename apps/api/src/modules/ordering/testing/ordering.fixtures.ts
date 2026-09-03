import { CustomerId, OrderId, SkuId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import { Quantity } from '../../../shared/kernel/quantity';
import { Order } from '../domain/order/order';
import { OrderLine } from '../domain/order/order-line';
import type { OrderStatus } from '../domain/order/order-status';
import { ShippingAddress } from '../domain/order/shipping-address';

const tail = (marker: string, suffix: string): string => `${marker}${suffix.padStart(6, '0')}`;

/**
 * 마지막 그룹은 **16진수 12자리**여야 한다. 마커에 16진수가 아닌 글자를 쓰면
 * `InvalidIdError`가 난다 — 계획 3에서 `'l'`과 `'ver'`로, 계획 4의 태스크 5에서
 * `'dup'`으로 세 번 깨졌다.
 */
export const cartUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1a00', suffix)}`;
export const orderUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1b00', suffix)}`;
export const skuUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1c00', suffix)}`;
export const customerUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1d00', suffix)}`;
export const addressUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0e1e00', suffix)}`;
export const FIXED_NOW = new Date('2026-03-01T00:00:00.000Z');

/**
 * 테스트용 주문 조립 도구. 세 핸들러 spec과 취소 spec이 공유한다 —
 * 각자 복사해 두면 넷이 서서히 갈라진다.
 */
export const SHIPPING_ADDRESS = ShippingAddress.of({
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: null,
});

export function anOrderLine(suffix: string, amount = 1000n, quantity = 2): OrderLine {
  return OrderLine.of({
    skuId: SkuId.of(skuUuid(suffix)),
    nameSnapshot: `상품 ${suffix}`,
    unitPrice: Money.of(amount),
    quantity: Quantity.positive(quantity),
  });
}

/**
 * 원하는 상태까지 몰고 간 주문. **전이는 애그리거트 메서드로만 한다** — 상태를
 * 직접 대입하면 그 상태에 도달할 수 없는 조합도 테스트가 만들어낸다.
 */
export function anOrderInStatus(status: OrderStatus, ownerSuffix = '1'): Order {
  const owner = CustomerId.of(customerUuid(ownerSuffix));
  const order = Order.place({
    id: OrderId.of(orderUuid('1')),
    customerId: owner,
    lines: [anOrderLine('1')],
    shippingAddress: SHIPPING_ADDRESS,
    now: FIXED_NOW,
  });
  if (status !== 'PENDING_PAYMENT') {
    if (status === 'PAYMENT_FAILED') {
      order.failPayment('거절', FIXED_NOW);
    } else if (status === 'CANCELLED') {
      order.cancelBy(owner, FIXED_NOW);
    } else {
      order.markPaid(FIXED_NOW);
    }
  }
  if (status === 'REFUND_PENDING' || status === 'REFUNDED') {
    order.cancelBy(owner, FIXED_NOW);
  }
  if (status === 'REFUNDED') {
    order.markRefunded(FIXED_NOW);
  }
  order.pullEvents();
  return order;
}
