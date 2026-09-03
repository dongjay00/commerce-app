import { describe, expect, it } from 'vitest';
import { CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import { Order } from '../../domain/order/order';
import { InMemoryOrderQuery } from '../../testing/in-memory-order.query';
import { InMemoryOrderRepository } from '../../testing/in-memory-order.repository';
import {
  anOrderLine,
  customerUuid,
  FIXED_NOW,
  orderUuid,
  SHIPPING_ADDRESS,
} from '../../testing/ordering.fixtures';
import { ListMyOrdersService } from './list-my-orders.service';

const OWNER = customerUuid('1');

/** limit 상한을 넘기려면 뷰가 여러 건 있어야 한다. 그 경계만 세는 fake 포트. */
class CountingOrderQuery extends InMemoryOrderQuery {
  lastLimit = -1;

  override async listByCustomer(customerId: CustomerId, params: { limit: number; offset: number }) {
    this.lastLimit = params.limit;
    return super.listByCustomer(customerId, params);
  }
}

async function build() {
  const orders = new InMemoryOrderRepository();
  const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * 60_000);
  for (const [suffix, minutes, owner] of [
    ['1', 10, '1'],
    ['2', 30, '1'],
    ['3', 20, '1'],
    ['4', 40, '2'],
  ] as const) {
    const order = Order.place({
      id: OrderId.of(orderUuid(suffix)),
      customerId: CustomerId.of(customerUuid(owner)),
      lines: [anOrderLine('1'), anOrderLine('2')],
      shippingAddress: SHIPPING_ADDRESS,
      now: at(minutes),
    });
    order.pullEvents();
    await orders.save(order);
  }
  const query = new CountingOrderQuery(orders);
  return { service: new ListMyOrdersService(query), query };
}

describe('ListMyOrdersService', () => {
  it('최신 주문부터 돌려준다', async () => {
    const { service } = await build();

    const found = await service.execute({ customerId: OWNER, limit: 10, offset: 0 });

    expect(found.map((o) => o.id)).toEqual([orderUuid('2'), orderUuid('3'), orderUuid('1')]);
  });

  it('다른 고객의 주문이 섞이지 않는다', async () => {
    const { service } = await build();
    const found = await service.execute({ customerId: OWNER, limit: 10, offset: 0 });
    expect(found.map((o) => o.id)).not.toContain(orderUuid('4'));
  });

  it('limit과 offset이 동작한다', async () => {
    const { service } = await build();
    const page = await service.execute({ customerId: OWNER, limit: 1, offset: 1 });
    expect(page.map((o) => o.id)).toEqual([orderUuid('3')]);
  });

  it('lineCount가 라인 수다', async () => {
    // 목록에 라인 전체를 실으면 20건 조회에 200줄이 딸려온다.
    const { service } = await build();
    const found = await service.execute({ customerId: OWNER, limit: 10, offset: 0 });
    expect(found[0]?.lineCount).toBe(2);
  });

  it('limit이 100을 넘으면 100으로 자른다', async () => {
    // 상한이 없으면 한 요청이 고객의 전체 주문 이력을 훑는다.
    const { service, query } = await build();

    await service.execute({ customerId: OWNER, limit: 5000, offset: 0 });

    expect(query.lastLimit).toBe(100);
  });
});
