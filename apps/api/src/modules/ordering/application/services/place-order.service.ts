import { Logger } from '@nestjs/common';
import { AddressId, CustomerId, OrderId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../shared/kernel/ports/domain-event.publisher';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Order } from '../../domain/order/order';
import {
  EmptyCartError,
  OutOfStockError,
  ShippingAddressNotFoundError,
  UnknownSkuError,
} from '../../domain/order/order.errors';
import { OrderLine } from '../../domain/order/order-line';
import type {
  PlaceOrderCommand,
  PlaceOrderResult,
  PlaceOrderUseCase,
} from '../ports/in/place-order.usecase';
import type { CartRepository } from '../ports/out/cart.repository';
import type { CatalogPriceProvider } from '../ports/out/catalog-price.provider';
import type { CustomerAddressProvider } from '../ports/out/customer-address.provider';
import type { InventoryReserver } from '../ports/out/inventory-reserver';
import type { OrderRepository } from '../ports/out/order.repository';
import type { AuthorizeOutcome, PaymentGateway } from '../ports/out/payment.gateway';

/**
 * 주문 사가. 스펙 §6.2의 다섯 단계를 오케스트레이션한다.
 *
 * **Order의 상태 머신이 사가 상태를 겸한다** — 별도 사가 엔티티가 없다.
 *
 * 트랜잭션 경계:
 * - [트랜잭션 1] 조립 + 저장 + `OrderPlaced` + 장바구니 삭제
 * - [트랜잭션 없음] 줄마다 재고 예약 — Inventory가 자기 트랜잭션을 연다
 * - [트랜잭션 없음] 결제 승인 — 외부 PG
 * - [트랜잭션 3] `markPaid` 또는 `failPayment` + 이벤트 발행
 *
 * 예약과 결제를 트랜잭션 밖에 두는 이유: 외부 응답을 기다리며 DB 트랜잭션을 열어두면
 * 커넥션 풀이 말라죽는다(스펙 §6.1). 예약도 마찬가지다 — Inventory가 `FOR UPDATE`로
 * 잠근 행을 우리 트랜잭션이 감싸면 잠금 보유 시간이 결제 시간만큼 늘어난다.
 */
export class PlaceOrderService implements PlaceOrderUseCase {
  private readonly logger = new Logger(PlaceOrderService.name);

  constructor(
    private readonly carts: CartRepository,
    private readonly orders: OrderRepository,
    private readonly catalog: CatalogPriceProvider,
    private readonly addresses: CustomerAddressProvider,
    private readonly inventory: InventoryReserver,
    private readonly payments: PaymentGateway,
    private readonly transactions: TransactionManager,
    private readonly events: DomainEventPublisher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<PlaceOrderResult> {
    const customerId = CustomerId.of(command.customerId);
    const addressId = AddressId.of(command.addressId);

    // [트랜잭션 1] 주문을 만든다. 여기까지 실패하면 아무 부수 효과도 남지 않는다.
    const order = await this.assemble(customerId, addressId);

    // [트랜잭션 없음] 줄마다 예약. 중간에 실패하면 이미 잡은 것을 푼다.
    const reservationIds = await this.reserveAll(order);

    // [트랜잭션 없음] 외부 PG.
    let outcome: AuthorizeOutcome;
    try {
      outcome = await this.payments.authorize({ orderId: order.id, amount: order.total });
    } catch (error) {
      // 결과가 아니라 오류다. 승인됐는지 알 수 없으므로 "실패"를 이벤트로 선언할 수
      // 없다 — 주문은 PENDING_PAYMENT로 두고 예약만 풀어 TTL에 맡긴다.
      await this.releaseAll(reservationIds);
      throw error;
    }

    // [트랜잭션 3] 결과를 주문에 반영한다. 예약 확정·해제는 구독자가 이벤트를 받아
    // 처리한다 — 여기서 직접 부르면 서버가 죽을 때 보상이 유실된다(스펙 §6.3).
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      if (outcome.ok) {
        order.markPaid(now);
      } else {
        order.failPayment(outcome.reason, now);
      }
      await this.orders.save(order, tx);
      await this.events.publish(order.pullEvents(), tx);
      return { orderId: order.id, status: order.status };
    });
  }

  private async assemble(customerId: CustomerId, addressId: AddressId): Promise<Order> {
    const now = this.clock.now();

    return this.transactions.run(async (tx) => {
      const cart = await this.carts.findByCustomerId(customerId, tx);
      if (cart === null || cart.isEmpty) {
        throw new EmptyCartError();
      }

      const shippingAddress = await this.addresses.findAddress(customerId, addressId);
      if (shippingAddress === null) {
        throw new ShippingAddressNotFoundError(addressId);
      }

      const skuIds = cart.lines.map((line) => line.skuId);
      const priced = await this.catalog.findPrices(skuIds);
      const bySkuId = new Map(priced.map((item) => [item.skuId as string, item]));

      // 없는 SKU는 결과에서 빠진다 — 포트의 계약이다. 무엇이 빠졌는지 여기서 센다.
      const missing = skuIds.filter((skuId) => !bySkuId.has(skuId));
      if (missing.length > 0) {
        throw new UnknownSkuError(missing);
      }

      const lines = cart.lines.map((line) => {
        const item = bySkuId.get(line.skuId);
        if (item === undefined) {
          // 위에서 이미 걸렀다. 타입을 좁히기 위한 방어선이다.
          throw new UnknownSkuError([line.skuId]);
        }
        return OrderLine.of({
          skuId: line.skuId,
          nameSnapshot: item.nameSnapshot,
          unitPrice: item.unitPrice,
          quantity: line.quantity,
        });
      });

      const order = Order.place({
        id: OrderId.of(this.ids.nextId()),
        customerId,
        lines,
        shippingAddress,
        now,
      });
      await this.orders.save(order, tx);
      await this.events.publish(order.pullEvents(), tx);

      // 주문이 만들어졌으므로 장바구니를 비운다. 이후 단계가 실패해도 되살리지
      // 않는다 — 주문은 이미 존재하고, 같은 장바구니로 다시 주문하면 주문이 둘이 된다.
      await this.carts.delete(cart.id, tx);
      return order;
    });
  }

  /**
   * 줄마다 예약한다. **중간에 실패하면 이미 잡은 것을 전부 푼다.**
   *
   * 풀지 않으면 그 재고가 TTL(15분)까지 묶인다. 재고가 하나 부족했을 뿐인데 나머지
   * 상품까지 15분간 팔 수 없게 되는 것이다.
   */
  private async reserveAll(order: Order): Promise<string[]> {
    const acquired: string[] = [];

    for (const line of order.lines) {
      const outcome = await this.inventory.reserve({
        orderId: order.id,
        skuId: line.skuId,
        quantity: line.quantity,
      });
      if (outcome.ok) {
        acquired.push(outcome.reservationId);
        continue;
      }
      await this.releaseAll(acquired);
      if (outcome.reason === 'OUT_OF_STOCK') {
        throw new OutOfStockError(line.skuId);
      }
      // SKU_UNKNOWN: Catalog는 아는데 Inventory는 모르는 SKU다. 재고 등록이
      // 빠진 것이므로 사용자가 고칠 수 없다 — UnknownSkuError(422)로 말하면
      // "장바구니에서 빼라"는 잘못된 안내가 된다.
      throw new Error(`재고가 등록되지 않은 SKU입니다: ${line.skuId}`);
    }
    return acquired;
  }

  /**
   * 보상. **실패해도 던지지 않는다.**
   *
   * 스펙 §6.2의 5단계: 보상 트랜잭션 자체가 실패해도 TTL이 결국 재고를 회복시킨다.
   * 여기서 던지면 원래 실패 이유(재고 부족, PG 타임아웃)가 보상 실패에 가려지고
   * 사용자는 500만 본다.
   */
  private async releaseAll(reservationIds: readonly string[]): Promise<void> {
    for (const reservationId of reservationIds) {
      try {
        await this.inventory.release({ reservationId });
      } catch (error) {
        this.logger.error(
          `예약 해제 실패 (reservationId=${reservationId}): ${String(error)} — TTL 만료가 회수한다`,
        );
      }
    }
  }
}
