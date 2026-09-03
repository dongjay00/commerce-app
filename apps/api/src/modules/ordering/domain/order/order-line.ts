import type { SkuId } from '../../../../shared/kernel/identifiers';
import type { Money } from '../../../../shared/kernel/money';
import type { Quantity } from '../../../../shared/kernel/quantity';

interface OrderLineParams {
  readonly skuId: SkuId;
  readonly nameSnapshot: string;
  readonly unitPrice: Money;
  readonly quantity: Quantity;
}

/**
 * 주문 한 줄. **불변 VO이고 자체 id가 없다** — `(order_id, sku_id)`가 자연키다(스펙 §10.8).
 *
 * `nameSnapshot`과 `unitPrice`가 스냅샷이다(스펙 §5.3). Catalog의 상품이 이름을 바꾸거나
 * 가격을 올려도 과거 주문은 그때의 값을 그대로 보여준다.
 *
 * **`of`가 던지는 것이 `DomainError`가 아니라 평문 `Error`인 이유**: 세 조건(이름 있음,
 * 단가 > 0, 수량 ≥ 1)은 사용자 입력이 아니라 **ACL이 돌려준 값과 장바구니 상태의
 * 조합**이다. 사용자는 단가를 보내지 않는다 — Catalog가 준다. 여기 도달했다면 ACL이나
 * 장바구니가 깨진 것이고 사용자가 고칠 수 있는 것이 없다. 500이 맞다.
 */
export class OrderLine {
  private constructor(
    readonly skuId: SkuId,
    readonly nameSnapshot: string,
    readonly unitPrice: Money,
    readonly quantity: Quantity,
  ) {}

  /** 인바운드 전용. */
  static of(params: OrderLineParams): OrderLine {
    if (params.nameSnapshot.trim().length === 0) {
      throw new Error('주문 라인의 이름 스냅샷이 비어 있습니다.');
    }
    if (params.unitPrice.amount <= 0n) {
      throw new Error(`주문 라인의 단가는 0보다 커야 합니다: ${params.unitPrice.amount}`);
    }
    if (params.quantity.value < 1) {
      throw new Error(`주문 라인의 수량은 1개 이상이어야 합니다: ${params.quantity.value}`);
    }
    return new OrderLine(
      params.skuId,
      params.nameSnapshot.trim(),
      params.unitPrice,
      params.quantity,
    );
  }

  /** 영속 복원 전용. 실패는 데이터 손상(500). */
  static fromPersistence(params: OrderLineParams): OrderLine {
    if (params.nameSnapshot.trim().length === 0) {
      throw new Error('저장된 주문 라인의 이름 스냅샷이 비어 있습니다.');
    }
    if (params.unitPrice.amount <= 0n || params.quantity.value < 1) {
      throw new Error(
        `저장된 주문 라인이 손상되었습니다: 단가 ${params.unitPrice.amount}, 수량 ${params.quantity.value}`,
      );
    }
    return new OrderLine(
      params.skuId,
      params.nameSnapshot.trim(),
      params.unitPrice,
      params.quantity,
    );
  }

  /** 태스크 1이 추가한 `Money.multiply(Quantity)`의 첫 사용처다. */
  get subtotal(): Money {
    return this.unitPrice.multiply(this.quantity);
  }
}
