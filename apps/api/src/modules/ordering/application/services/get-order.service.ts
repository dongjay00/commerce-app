import { OrderId } from '../../../../shared/kernel/identifiers';
import { OrderNotFoundError, OrderNotOwnedError } from '../../domain/order/order.errors';
import type { GetOrderQuery } from '../ports/in/queries/get-order.query';
import type { OrderQuery, OrderView } from '../ports/out/order.query';

/**
 * 주문 상세 조회. **애그리거트를 거치지 않는다**(스펙 §7.2) — 주문은 스냅샷을 갖고
 * 있어 다른 컨텍스트를 부를 필요가 없고, Prisma가 직접 projection한다.
 *
 * 조회 인가를 서비스가 한다. `OrderQuery`는 DTO를 돌려주므로 `Order.assertOwnedBy`를
 * 부를 수 없다. **도메인 규칙이 새는 것이 아니다** — 스펙 §5.5가 도메인에 두라고 한
 * 것은 "본인 주문만 **취소** 가능"이고 그것은 `Order.cancelBy`에 있다. 조회는 상태를
 * 바꾸지 않으므로 불변식이 아니다.
 *
 * 없는 주문(404)과 남의 주문(403)을 다른 예외로 구분한다. 같게 만들면 존재 여부가
 * 새지 않지만, 주문 ID가 UUID v7이라 추측이 사실상 불가능하므로 진단 가능성을 택한다.
 */
export class GetOrderService implements GetOrderQuery {
  constructor(private readonly orders: OrderQuery) {}

  async execute(command: { orderId: string; customerId: string }): Promise<OrderView> {
    const view = await this.orders.findById(OrderId.of(command.orderId));
    if (view === null) {
      throw new OrderNotFoundError(command.orderId);
    }
    if (view.customerId !== command.customerId) {
      throw new OrderNotOwnedError(command.orderId);
    }
    return view;
  }
}
