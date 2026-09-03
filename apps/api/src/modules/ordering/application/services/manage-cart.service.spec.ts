import { describe, expect, it } from 'vitest';
import { CustomerId } from '../../../../shared/kernel/identifiers';
import { QuantityBelowMinimumError } from '../../../../shared/kernel/quantity';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { CartLineNotFoundError, CartNotFoundError } from '../../domain/cart/cart.errors';
import { InMemoryCartRepository } from '../../testing/in-memory-cart.repository';
import { customerUuid, skuUuid } from '../../testing/ordering.fixtures';
import { ManageCartService } from './manage-cart.service';

const CUSTOMER = customerUuid('1');
const SKU = skuUuid('1');

function build() {
  const carts = new InMemoryCartRepository();
  const service = new ManageCartService(
    carts,
    new PassthroughTransactionManager(),
    new SequentialIdGenerator(),
  );
  return { carts, service };
}

describe('ManageCartService.addItem', () => {
  it('장바구니가 없으면 만들어서 담는다', async () => {
    const { service, carts } = build();

    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 2 });

    const cart = await carts.findByCustomerId(CustomerId.of(CUSTOMER));
    expect(cart?.lines).toHaveLength(1);
    expect(cart?.lines[0]?.quantity.value).toBe(2);
  });

  it('두 번 담으면 장바구니가 하나만 만들어진다', async () => {
    // 매번 새로 만들면 carts.customer_id 유니크에 걸려 두 번째가 500으로 죽는다.
    const { service, carts } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });
    const first = await carts.findByCustomerId(CustomerId.of(CUSTOMER));

    await service.addItem({ customerId: CUSTOMER, skuId: skuUuid('2'), quantity: 1 });

    const second = await carts.findByCustomerId(CustomerId.of(CUSTOMER));
    expect(second?.id).toBe(first?.id);
    expect(second?.lines).toHaveLength(2);
  });

  it('수량 0은 QuantityBelowMinimumError다', async () => {
    const { service } = build();
    await expect(
      service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 0 }),
    ).rejects.toThrow(QuantityBelowMinimumError);
  });

  it('수량 0이면 장바구니를 만들지 않는다', async () => {
    // 값 객체 생성이 저장 전에 있어야 한다. 순서가 반대면 실패한 요청이
    // 빈 장바구니를 남긴다 — PassthroughTransactionManager는 롤백하지 않으므로
    // 트랜잭션 경계를 방어로 쓰는 설계는 여기서 드러난다.
    const { service, carts } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 0 }).catch(() => undefined);

    expect(await carts.findByCustomerId(CustomerId.of(CUSTOMER))).toBeNull();
  });
});

describe('ManageCartService.removeItem', () => {
  it('줄을 뺀다', async () => {
    const { service, carts } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });

    await service.removeItem({ customerId: CUSTOMER, skuId: SKU });

    expect((await carts.findByCustomerId(CustomerId.of(CUSTOMER)))?.isEmpty).toBe(true);
  });

  it('장바구니가 없으면 CartNotFoundError다', async () => {
    // 조용히 성공시키면 클라이언트가 상태를 잘못 알고 있다는 사실이 드러나지 않는다.
    const { service } = build();
    await expect(service.removeItem({ customerId: CUSTOMER, skuId: SKU })).rejects.toThrow(
      CartNotFoundError,
    );
  });

  it('없는 줄을 빼면 CartLineNotFoundError다', async () => {
    const { service } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });

    await expect(service.removeItem({ customerId: CUSTOMER, skuId: skuUuid('9') })).rejects.toThrow(
      CartLineNotFoundError,
    );
  });
});

describe('ManageCartService.changeQuantity', () => {
  it('수량을 바꾼다', async () => {
    const { service, carts } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });

    await service.changeQuantity({ customerId: CUSTOMER, skuId: SKU, quantity: 7 });

    expect((await carts.findByCustomerId(CustomerId.of(CUSTOMER)))?.lines[0]?.quantity.value).toBe(
      7,
    );
  });

  it('장바구니가 없으면 CartNotFoundError다', async () => {
    const { service } = build();
    await expect(
      service.changeQuantity({ customerId: CUSTOMER, skuId: SKU, quantity: 1 }),
    ).rejects.toThrow(CartNotFoundError);
  });

  it('수량 0은 QuantityBelowMinimumError다', async () => {
    const { service } = build();
    await service.addItem({ customerId: CUSTOMER, skuId: SKU, quantity: 1 });

    await expect(
      service.changeQuantity({ customerId: CUSTOMER, skuId: SKU, quantity: 0 }),
    ).rejects.toThrow(QuantityBelowMinimumError);
  });
});
