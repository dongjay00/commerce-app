import type { PrismaClient } from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { CustomerId, OrderId } from '../../../../../shared/kernel/identifiers';
import { Order } from '../../../domain/order/order';
import {
  anOrderLine,
  customerUuid,
  FIXED_NOW,
  orderUuid,
  SHIPPING_ADDRESS,
} from '../../../testing/ordering.fixtures';
import { PrismaOrderQuery } from './prisma-order.query';
import { PrismaOrderRepository } from './prisma-order.repository';

let db: PrismaClient;
const OWNER = customerUuid('1');

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE orders CASCADE');
});

/** 저장은 리포지토리로 한다 — 원시 SQL이면 매퍼를 건너뛴다. */
async function save(suffix: string, minutes: number, owner = '1'): Promise<void> {
  const order = Order.place({
    id: OrderId.of(orderUuid(suffix)),
    customerId: CustomerId.of(customerUuid(owner)),
    lines: [anOrderLine('1'), anOrderLine('2')],
    shippingAddress: SHIPPING_ADDRESS,
    now: new Date(FIXED_NOW.getTime() + minutes * 60_000),
  });
  order.pullEvents();
  await new PrismaTransactionManager(db).run((tx) => new PrismaOrderRepository(db).save(order, tx));
}

describe('PrismaOrderQuery', () => {
  it('주문 상세를 뷰로 돌려준다 — 애그리거트를 만들지 않는다', async () => {
    await save('1', 10);

    const view = await new PrismaOrderQuery(db).findById(OrderId.of(orderUuid('1')));

    expect(view?.status).toBe('PENDING_PAYMENT');
    expect(view?.customerId).toBe(OWNER);
    expect(view?.total).toEqual({ amount: '4000', currency: 'KRW' });
    expect(view?.shippingAddress.recipient).toBe('홍길동');
    expect(view?.lines).toHaveLength(2);
    expect(view?.lines[0]?.subtotal).toEqual({ amount: '2000', currency: 'KRW' });
  });

  it('없는 주문은 null이다', async () => {
    expect(await new PrismaOrderQuery(db).findById(OrderId.of(orderUuid('99')))).toBeNull();
  });

  it('목록이 placedAt 내림차순이고 lineCount가 맞다', async () => {
    // 삽입 순서와 placedAt 순서를 다르게 둔다.
    await save('11', 10);
    await save('12', 30);
    await save('13', 20);

    const found = await new PrismaOrderQuery(db).listByCustomer(CustomerId.of(OWNER), {
      limit: 10,
      offset: 0,
    });

    expect(found.map((o) => o.id)).toEqual([orderUuid('12'), orderUuid('13'), orderUuid('11')]);
    expect(found[0]?.lineCount).toBe(2);
  });

  it('다른 고객의 주문이 섞이지 않는다', async () => {
    await save('21', 10, '1');
    await save('22', 20, '2');

    const found = await new PrismaOrderQuery(db).listByCustomer(CustomerId.of(OWNER), {
      limit: 10,
      offset: 0,
    });

    expect(found.map((o) => o.id)).toEqual([orderUuid('21')]);
  });

  it('limit과 offset이 동작한다', async () => {
    await save('31', 10);
    await save('32', 20);
    await save('33', 30);

    const page = await new PrismaOrderQuery(db).listByCustomer(CustomerId.of(OWNER), {
      limit: 1,
      offset: 1,
    });

    expect(page.map((o) => o.id)).toEqual([orderUuid('32')]);
  });
});
