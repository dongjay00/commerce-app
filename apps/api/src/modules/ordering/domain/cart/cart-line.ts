import type { SkuId } from '../../../../shared/kernel/identifiers';
import type { Quantity } from '../../../../shared/kernel/quantity';

/**
 * 장바구니 한 줄. **불변 VO다** — 수량을 바꾸면 새 인스턴스를 만든다.
 *
 * 계획 3의 `SavedAddress`가 가변으로 시작했다가 `withPrice`로 바뀐 교훈을 따른다.
 * 가변 엔티티를 컬렉션에 담으면 `Cart` 밖으로 새어 나간 참조가 애그리거트의 불변식을
 * 우회해 상태를 바꾼다.
 */
export class CartLine {
  constructor(
    readonly skuId: SkuId,
    readonly quantity: Quantity,
  ) {}

  withQuantity(quantity: Quantity): CartLine {
    return new CartLine(this.skuId, quantity);
  }
}
