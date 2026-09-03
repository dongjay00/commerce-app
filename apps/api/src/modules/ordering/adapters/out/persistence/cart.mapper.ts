import { CartId, CustomerId, SkuId } from '../../../../../shared/kernel/identifiers';
import { Quantity } from '../../../../../shared/kernel/quantity';
import { Cart } from '../../../domain/cart/cart';
import { CartLine } from '../../../domain/cart/cart-line';

export interface CartLineRow {
  skuId: string;
  quantity: number;
}

export interface CartRow {
  id: string;
  customerId: string;
  lines: CartLineRow[];
}

/**
 * 저장된 행 → 애그리거트.
 *
 * `fromPersistence`를 쓴다 — `.of`는 깨진 행에 400을 내고 클라이언트에게 거짓말한다
 * (계획 1의 M7).
 *
 * `Quantity.of`를 쓴다, `positive`가 아니라. 저장된 수량이 0이면 그것은 데이터
 * 손상이고 `of`가 던지는 `InvalidQuantityError`는 평문 `Error`(500)다. `positive`를
 * 쓰면 `QuantityBelowMinimumError`(`DomainError`, 422)가 나가 손상된 행을 사용자
 * 잘못으로 만든다. 계획 3의 `reservation.mapper.ts`가 같은 판단을 문서화했다.
 */
export function toCartDomain(row: CartRow): Cart {
  return Cart.rehydrate({
    id: CartId.fromPersistence(row.id),
    customerId: CustomerId.fromPersistence(row.customerId),
    lines: row.lines.map(
      (line) => new CartLine(SkuId.fromPersistence(line.skuId), Quantity.of(line.quantity)),
    ),
  });
}
