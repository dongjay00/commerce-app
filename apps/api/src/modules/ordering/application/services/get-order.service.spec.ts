import { describe, expect, it } from 'vitest';
import { OrderNotFoundError, OrderNotOwnedError } from '../../domain/order/order.errors';
import { InMemoryOrderQuery } from '../../testing/in-memory-order.query';
import { InMemoryOrderRepository } from '../../testing/in-memory-order.repository';
import { anOrderInStatus, customerUuid, orderUuid } from '../../testing/ordering.fixtures';
import { GetOrderService } from './get-order.service';

const OWNER = customerUuid('1');
const STRANGER = customerUuid('2');
const ORDER = orderUuid('1');

async function build() {
  const orders = new InMemoryOrderRepository();
  await orders.save(anOrderInStatus('PAID'));
  return { service: new GetOrderService(new InMemoryOrderQuery(orders)) };
}

describe('GetOrderService', () => {
  it('본인 주문을 돌려준다', async () => {
    const { service } = await build();

    const view = await service.execute({ orderId: ORDER, customerId: OWNER });

    expect(view.id).toBe(ORDER);
    expect(view.status).toBe('PAID');
    expect(view.lines).toHaveLength(1);
    expect(view.shippingAddress.recipient).toBe('홍길동');
  });

  it('소계가 뷰에 포함된다', async () => {
    // 1000 × 2
    const { service } = await build();
    const view = await service.execute({ orderId: ORDER, customerId: OWNER });
    expect(view.lines[0]?.subtotal).toEqual({ amount: '2000', currency: 'KRW' });
  });

  it('남의 주문은 OrderNotOwnedError다', async () => {
    // 이 검사가 없으면 주문 ID만 알면 남의 배송지와 구매 내역이 보인다.
    const { service } = await build();
    await expect(service.execute({ orderId: ORDER, customerId: STRANGER })).rejects.toThrow(
      OrderNotOwnedError,
    );
  });

  it('없는 주문은 OrderNotFoundError다', async () => {
    const { service } = await build();
    await expect(service.execute({ orderId: orderUuid('9'), customerId: OWNER })).rejects.toThrow(
      OrderNotFoundError,
    );
  });
});
