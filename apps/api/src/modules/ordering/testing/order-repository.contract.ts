import { describe, expect, it } from 'vitest';
import { CustomerId, OrderId, SkuId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import { Quantity } from '../../../shared/kernel/quantity';
import type { OrderRepository } from '../application/ports/out/order.repository';
import { Order } from '../domain/order/order';
import { OrderLine } from '../domain/order/order-line';
import { ShippingAddress } from '../domain/order/shipping-address';
import { customerUuid, FIXED_NOW, orderUuid, skuUuid } from './ordering.fixtures';

const ADDRESS = ShippingAddress.of({
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: '3층',
});

const line = (suffix: string, amount: bigint, qty: number): OrderLine =>
  OrderLine.of({
    skuId: SkuId.of(skuUuid(suffix)),
    nameSnapshot: `상품 ${suffix}`,
    unitPrice: Money.of(amount),
    quantity: Quantity.positive(qty),
  });

/**
 * OrderRepository 계약. **같은 스위트가 in-memory와 Prisma 양쪽에서 통과해야 한다**
 * (스펙 §9.2).
 */
export function orderRepositoryContract(
  name: string,
  createRepo: () => Promise<OrderRepository>,
): void {
  describe(`OrderRepository 계약 — ${name}`, () => {
    const place = (
      suffix: string,
      options: { customer?: string; placedAt?: Date; lines?: OrderLine[] } = {},
    ): Order => {
      const order = Order.place({
        id: OrderId.of(orderUuid(suffix)),
        customerId: CustomerId.of(customerUuid(options.customer ?? '1')),
        lines: options.lines ?? [line('1', 1200n, 3), line('2', 500n, 2)],
        shippingAddress: ADDRESS,
        now: options.placedAt ?? FIXED_NOW,
      });
      order.pullEvents();
      return order;
    };

    it('없는 id는 null이다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(OrderId.of(orderUuid('99')))).toBeNull();
    });

    it('저장한 주문을 id로 찾고 총액·상태·배송지가 그대로다', async () => {
      const repo = await createRepo();
      await repo.save(place('1'));

      const found = await repo.findById(OrderId.of(orderUuid('1')));
      expect(found?.total.amount).toBe(4600n);
      expect(found?.status).toBe('PENDING_PAYMENT');
      expect(found?.shippingAddress.recipient).toBe('홍길동');
      expect(found?.shippingAddress.line2).toBe('3층');
      expect(found?.placedAt.toISOString()).toBe(FIXED_NOW.toISOString());
    });

    it('라인이 스냅샷 그대로 복원된다', async () => {
      const repo = await createRepo();
      await repo.save(place('2'));

      const found = await repo.findById(OrderId.of(orderUuid('2')));
      const first = found?.lines.find((l) => l.skuId === skuUuid('1'));
      expect(first?.nameSnapshot).toBe('상품 1');
      expect(first?.unitPrice.amount).toBe(1200n);
      expect(first?.quantity.value).toBe(3);
      expect(found?.lines).toHaveLength(2);
    });

    it('상태 변화가 저장된다', async () => {
      const repo = await createRepo();
      const order = place('3');
      await repo.save(order);

      order.markPaid(FIXED_NOW);
      await repo.save(order);

      expect((await repo.findById(OrderId.of(orderUuid('3'))))?.status).toBe('PAID');
    });

    it('같은 주문을 두 번 저장해도 라인이 중복되지 않는다', async () => {
      const repo = await createRepo();
      const order = place('4');
      await repo.save(order);
      await repo.save(order);

      expect((await repo.findById(OrderId.of(orderUuid('4'))))?.lines).toHaveLength(2);
    });

    it('돌려준 주문을 바꿔도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      await repo.save(place('5'));

      const first = await repo.findById(OrderId.of(orderUuid('5')));
      first?.markPaid(FIXED_NOW);

      expect((await repo.findById(OrderId.of(orderUuid('5'))))?.status).toBe('PENDING_PAYMENT');
    });

    it('listByCustomer가 최신 주문부터 돌려준다', async () => {
      // 삽입 순서와 placedAt 순서를 다르게 둔다 — 같으면 정렬을 지워도 통과해
      // 이 테스트가 아무것도 검증하지 못한다.
      const repo = await createRepo();
      const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * 60_000);
      await repo.save(place('11', { customer: '8', placedAt: at(10) }));
      await repo.save(place('12', { customer: '8', placedAt: at(30) }));
      await repo.save(place('13', { customer: '8', placedAt: at(20) }));

      const found = await repo.listByCustomer(CustomerId.of(customerUuid('8')), {
        limit: 10,
        offset: 0,
      });

      expect(found.map((order) => order.id)).toEqual([
        orderUuid('12'),
        orderUuid('13'),
        orderUuid('11'),
      ]);
    });

    it('listByCustomer가 다른 고객의 주문을 섞지 않는다', async () => {
      const repo = await createRepo();
      await repo.save(place('21', { customer: '9' }));
      await repo.save(place('22', { customer: '10' }));

      const found = await repo.listByCustomer(CustomerId.of(customerUuid('9')), {
        limit: 10,
        offset: 0,
      });

      expect(found.map((order) => order.id)).toEqual([orderUuid('21')]);
    });

    it('listByCustomer의 limit과 offset이 동작한다', async () => {
      const repo = await createRepo();
      const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * 60_000);
      await repo.save(place('31', { customer: '11', placedAt: at(10) }));
      await repo.save(place('32', { customer: '11', placedAt: at(20) }));
      await repo.save(place('33', { customer: '11', placedAt: at(30) }));

      const page = await repo.listByCustomer(CustomerId.of(customerUuid('11')), {
        limit: 1,
        offset: 1,
      });

      expect(page.map((order) => order.id)).toEqual([orderUuid('32')]);
    });

    it('주문이 없는 고객은 빈 배열이다', async () => {
      const repo = await createRepo();
      expect(
        await repo.listByCustomer(CustomerId.of(customerUuid('97')), { limit: 10, offset: 0 }),
      ).toEqual([]);
    });
  });
}
