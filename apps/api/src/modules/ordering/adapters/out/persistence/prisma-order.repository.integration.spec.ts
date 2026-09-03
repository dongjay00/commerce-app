import { describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { OrderId } from '../../../../../shared/kernel/identifiers';
import { CorruptedOrderError } from '../../../domain/order/order.errors';
import { orderRepositoryContract } from '../../../testing/order-repository.contract';
import { PrismaOrderRepository } from './prisma-order.repository';

orderRepositoryContract('prisma', async () => new PrismaOrderRepository(await testDb()));

const ORDER = (suffix: string) => `018f2b1c-4a5d-7e6f-8a9b-0e1bcc${suffix.padStart(6, '0')}`;

async function insertOrder(
  db: Awaited<ReturnType<typeof testDb>>,
  id: string,
  overrides: { status?: string; currency?: string; total?: number; recipient?: string } = {},
): Promise<void> {
  await db.$executeRawUnsafe(`
    INSERT INTO orders (id, customer_id, status, total_amount, total_currency,
      ship_recipient, ship_phone, ship_zip, ship_line1, ship_line2, placed_at, updated_at)
    VALUES ('${id}', '018f2b1c-4a5d-7e6f-8a9b-0e1d00000001',
      '${overrides.status ?? 'PAID'}', ${overrides.total ?? 2000}, '${overrides.currency ?? 'KRW'}',
      '${overrides.recipient ?? '홍길동'}', '010-1234-5678', '06236', '서울시', NULL, now(), now())
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO order_lines (order_id, sku_id, name_snapshot, unit_price_amount, unit_price_currency, quantity)
    VALUES ('${id}', '018f2b1c-4a5d-7e6f-8a9b-0e1c00000001', '티셔츠', 1000, '${overrides.currency ?? 'KRW'}', 2)
  `);
}

describe('PrismaOrderRepository — 어댑터 전용', () => {
  it('알 수 없는 상태가 저장된 행을 읽으면 CorruptedOrderError다', async () => {
    // 계약 스위트는 정상 데이터만 다룬다. 손상된 행은 원시 SQL로만 만들 수 있다.
    const db = await testDb();
    const id = ORDER('1');
    await insertOrder(db, id, { status: 'WEIRD' });

    await expect(new PrismaOrderRepository(db).findById(OrderId.of(id))).rejects.toThrow(
      CorruptedOrderError,
    );
  });

  it('알 수 없는 통화가 저장된 행을 읽으면 CorruptedOrderError다', async () => {
    const db = await testDb();
    const id = ORDER('2');
    await insertOrder(db, id, { currency: 'JPY' });

    await expect(new PrismaOrderRepository(db).findById(OrderId.of(id))).rejects.toThrow(
      CorruptedOrderError,
    );
  });

  it('총액이 라인 합과 다르면 CorruptedOrderError다', async () => {
    // 스펙 §5.1의 불변식이 읽기 경로에서도 지켜지는지를 보는 유일한 테스트다.
    const db = await testDb();
    const id = ORDER('3');
    await insertOrder(db, id, { total: 9999 });

    await expect(new PrismaOrderRepository(db).findById(OrderId.of(id))).rejects.toThrow(
      /총액이 라인 합과 다릅니다/,
    );
  });

  it('배송지 수령인이 빈 저장 행은 CorruptedShippingAddressError다', async () => {
    // 매퍼가 `ShippingAddress.fromPersistence`를 쓰는지 확인하는 테스트다.
    // `.of`를 쓰면 InvalidShippingAddressError(400)가 나가 깨진 데이터를
    // 사용자 잘못으로 만든다 — 계획 1의 M7이 막으려는 거짓말이다.
    const db = await testDb();
    const id = ORDER('4');
    await insertOrder(db, id, { recipient: '' });

    await expect(new PrismaOrderRepository(db).findById(OrderId.of(id))).rejects.toThrow(
      /저장된 배송지 값이 비어 있습니다/,
    );
  });
});
