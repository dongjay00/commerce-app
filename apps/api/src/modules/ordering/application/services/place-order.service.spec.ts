import { describe, expect, it } from 'vitest';
import { AddressId, CustomerId, OrderId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { RecordingEventPublisher } from '../../../../shared/testing/recording-event-publisher';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import {
  EmptyCartError,
  OutOfStockError,
  ShippingAddressNotFoundError,
  UnknownSkuError,
} from '../../domain/order/order.errors';
import { ORDER_PAID, ORDER_PAYMENT_FAILED, ORDER_PLACED } from '../../domain/order/order.events';
import { ShippingAddress } from '../../domain/order/shipping-address';
import { FakeCatalogPriceProvider } from '../../testing/fake-catalog-price.provider';
import { FakeCustomerAddressProvider } from '../../testing/fake-customer-address.provider';
import { FakeInventoryReserver } from '../../testing/fake-inventory-reserver';
import { FakePaymentGateway } from '../../testing/fake-payment-gateway';
import { InMemoryCartRepository } from '../../testing/in-memory-cart.repository';
import { InMemoryOrderRepository } from '../../testing/in-memory-order.repository';
import { addressUuid, customerUuid, FIXED_NOW, skuUuid } from '../../testing/ordering.fixtures';
import { ManageCartService } from './manage-cart.service';
import { PlaceOrderService } from './place-order.service';

const CUSTOMER = customerUuid('1');
const ADDRESS = addressUuid('1');
const SKU_A = skuUuid('1');
const SKU_B = skuUuid('2');

const SHIPPING = ShippingAddress.of({
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: null,
});

async function build(lines: Array<[string, number]> = [[SKU_A, 3]]) {
  const carts = new InMemoryCartRepository();
  const orders = new InMemoryOrderRepository();
  const catalog = new FakeCatalogPriceProvider()
    .put(SkuId.of(SKU_A), '티셔츠 RED-M', Money.of(1200n))
    .put(SkuId.of(SKU_B), '모자 BLACK', Money.of(500n));
  const addresses = new FakeCustomerAddressProvider().put(
    CustomerId.of(CUSTOMER),
    AddressId.of(ADDRESS),
    SHIPPING,
  );
  const inventory = new FakeInventoryReserver();
  const payments = new FakePaymentGateway();
  const events = new RecordingEventPublisher();
  const transactions = new PassthroughTransactionManager();
  const ids = new SequentialIdGenerator();

  const cartService = new ManageCartService(carts, transactions, ids);
  for (const [skuId, quantity] of lines) {
    await cartService.addItem({ customerId: CUSTOMER, skuId, quantity });
  }

  const service = new PlaceOrderService(
    carts,
    orders,
    catalog,
    addresses,
    inventory,
    payments,
    transactions,
    events,
    new MutableClock(FIXED_NOW),
    ids,
  );
  return { service, carts, orders, catalog, addresses, inventory, payments, events };
}

const place = (service: PlaceOrderService) =>
  service.execute({ customerId: CUSTOMER, addressId: ADDRESS });

describe('PlaceOrderService — 성공 경로', () => {
  it('주문이 PAID로 끝난다', async () => {
    const { service } = await build();
    expect((await place(service)).status).toBe('PAID');
  });

  it('총액이 스냅샷 가격 × 수량의 합이다', async () => {
    // 1200×3 + 500×2 = 4600
    const { service, orders } = await build([
      [SKU_A, 3],
      [SKU_B, 2],
    ]);
    const { orderId } = await place(service);

    expect((await orders.findById(OrderId.of(orderId)))?.total.amount).toBe(4600n);
  });

  it('가격과 이름이 주문에 스냅샷으로 박힌다', async () => {
    // 스펙 §5.3. Catalog가 나중에 가격을 올려도 이 주문은 그대로다.
    const { service, orders } = await build();
    const { orderId } = await place(service);

    const order = await orders.findById(OrderId.of(orderId));
    expect(order?.lines[0]?.nameSnapshot).toBe('티셔츠 RED-M');
    expect(order?.lines[0]?.unitPrice.amount).toBe(1200n);
  });

  it('배송지가 스냅샷으로 박힌다', async () => {
    const { service, orders } = await build();
    const { orderId } = await place(service);

    expect((await orders.findById(OrderId.of(orderId)))?.shippingAddress.recipient).toBe('홍길동');
  });

  it('줄마다 재고를 예약한다', async () => {
    const { service, inventory } = await build([
      [SKU_A, 3],
      [SKU_B, 2],
    ]);
    await place(service);

    expect(inventory.reserved.map((r) => [r.skuId, r.quantity])).toEqual([
      [SKU_A, 3],
      [SKU_B, 2],
    ]);
  });

  it('주문 총액으로 결제를 요청한다', async () => {
    const { service, payments } = await build([
      [SKU_A, 3],
      [SKU_B, 2],
    ]);
    await place(service);

    expect(payments.calls).toEqual([{ orderId: expect.any(String), amount: '4600' }]);
  });

  it('OrderPlaced와 OrderPaid를 순서대로 발행한다', async () => {
    const { service, events } = await build();
    await place(service);

    expect(events.published.map((e) => e.eventType)).toEqual([ORDER_PLACED, ORDER_PAID]);
  });

  it('장바구니가 비워진다', async () => {
    const { service, carts } = await build();
    await place(service);

    expect(await carts.findByCustomerId(CustomerId.of(CUSTOMER))).toBeNull();
  });
});

describe('PlaceOrderService — 조립 단계 실패', () => {
  it('장바구니가 없으면 EmptyCartError다', async () => {
    const { service } = await build([]);
    await expect(place(service)).rejects.toThrow(EmptyCartError);
  });

  it('배송지가 없으면 ShippingAddressNotFoundError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({ customerId: CUSTOMER, addressId: addressUuid('9') }),
    ).rejects.toThrow(ShippingAddressNotFoundError);
  });

  it('Catalog가 모르는 SKU가 있으면 UnknownSkuError다', async () => {
    const { service } = await build([[skuUuid('7'), 1]]);
    await expect(place(service)).rejects.toThrow(UnknownSkuError);
  });

  it('모르는 SKU가 여럿이면 전부 메시지에 담는다', async () => {
    // 하나만 말하면 사용자가 장바구니를 고치고 다시 시도했다가 또 실패한다.
    // 안쪽 방어선(타입 좁히기용)은 첫 번째만 담으므로 이 단언이 바깥 검사를 고정한다.
    const { service } = await build([
      [skuUuid('7'), 1],
      [skuUuid('8'), 1],
    ]);

    const error = await place(service).then(
      () => null,
      (thrown: unknown) => thrown as Error,
    );

    expect(error?.message).toContain(skuUuid('7'));
    expect(error?.message).toContain(skuUuid('8'));
  });

  it('조립에 실패하면 재고를 예약하지 않는다', async () => {
    // 예약은 주문이 만들어진 뒤에만 일어난다. 순서가 뒤바뀌면 실패한 주문이
    // 재고를 15분 묶는다.
    const { service, inventory } = await build([[skuUuid('7'), 1]]);
    await place(service).catch(() => undefined);

    expect(inventory.reserved).toHaveLength(0);
  });
});

describe('PlaceOrderService — 재고 예약 실패와 보상', () => {
  it('재고가 없으면 OutOfStockError다', async () => {
    const { service, inventory } = await build();
    inventory.failFor(SkuId.of(SKU_A));

    await expect(place(service)).rejects.toThrow(OutOfStockError);
  });

  it('여러 줄 중 뒤쪽이 실패하면 앞에서 잡은 예약을 전부 푼다', async () => {
    // 이 태스크에서 가장 놓치기 쉬운 것이다. 풀지 않으면 그 재고가 TTL까지 묶인다.
    const { service, inventory } = await build([
      [SKU_A, 1],
      [SKU_B, 1],
    ]);
    inventory.failFor(SkuId.of(SKU_B));

    await place(service).catch(() => undefined);

    expect(inventory.reserved).toHaveLength(1);
    expect(inventory.released).toEqual(['reservation-1']);
  });

  it('예약이 실패하면 결제하지 않는다', async () => {
    const { service, inventory, payments } = await build();
    inventory.failFor(SkuId.of(SKU_A));

    await place(service).catch(() => undefined);

    expect(payments.calls).toHaveLength(0);
  });

  it('보상 자체가 실패해도 원래 예외가 나간다', async () => {
    // 스펙 §6.2의 5단계: 보상 트랜잭션이 실패해도 TTL이 결국 회수한다.
    // 여기서 보상 실패를 그대로 던지면 사용자는 "재고 부족" 대신 500을 본다.
    const { service, inventory } = await build([
      [SKU_A, 1],
      [SKU_B, 1],
    ]);
    inventory.failFor(SkuId.of(SKU_B)).failReleaseWith(new Error('예약 해제 실패'));

    await expect(place(service)).rejects.toThrow(OutOfStockError);
  });

  it('Inventory가 모르는 SKU면 UnknownSkuError가 아니라 평문 오류다', async () => {
    // Catalog는 아는데 Inventory는 모른다 = 재고 등록이 빠진 것이다. 사용자에게
    // "장바구니에서 빼라"고 안내하면 잘못된 지시가 된다.
    const { service, inventory } = await build();
    inventory.failFor(SkuId.of(SKU_A), 'SKU_UNKNOWN');

    await expect(place(service)).rejects.toThrow(/재고가 등록되지 않은 SKU/);
  });
});

describe('PlaceOrderService — 결제 실패와 보상', () => {
  it('거절되면 주문이 PAYMENT_FAILED로 끝나고 예외를 던지지 않는다', async () => {
    // 결제 거절은 주문이 정상적으로 끝난 상태다. 주문 번호가 있고 사용자는
    // 그 화면에서 다시 시도할 수 있다.
    const { service, payments } = await build();
    payments.decline();

    expect((await place(service)).status).toBe('PAYMENT_FAILED');
  });

  it('거절되면 OrderPaymentFailed를 발행한다 — 예약 해제는 구독자가 한다', async () => {
    // 여기서 직접 release를 부르지 않는다. 이벤트가 outbox를 거쳐야 서버가
    // 죽어도 보상이 유실되지 않는다(스펙 §6.3).
    const { service, payments, events, inventory } = await build();
    payments.decline('카드 한도를 초과했습니다.');

    await place(service);

    expect(events.published.map((e) => e.eventType)).toEqual([ORDER_PLACED, ORDER_PAYMENT_FAILED]);
    expect(events.published[1]?.payload).toMatchObject({ reason: '카드 한도를 초과했습니다.' });
    expect(inventory.released).toHaveLength(0);
  });

  it('PG가 던지면 예약을 풀고 예외를 올린다', async () => {
    // 타임아웃은 결과가 아니라 오류다. 결제 여부를 알 수 없으므로 이벤트로
    // "실패"를 선언할 수 없고(승인됐을 수도 있다), 예약만 풀고 TTL에 맡긴다.
    const { service, payments, inventory } = await build();
    payments.throwWith(new Error('PG 타임아웃'));

    await expect(place(service)).rejects.toThrow('PG 타임아웃');
    expect(inventory.released).toEqual(['reservation-1']);
  });

  it('PG가 던져도 주문은 PENDING_PAYMENT로 남는다', async () => {
    // 지워버리면 나중에 PG 정산에서 발견된 승인을 붙일 곳이 없어진다.
    const { service, payments, orders } = await build();
    payments.throwWith(new Error('PG 타임아웃'));
    await place(service).catch(() => undefined);

    const all = await orders.listByCustomer(CustomerId.of(CUSTOMER), { limit: 10, offset: 0 });
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('PENDING_PAYMENT');
  });
});
