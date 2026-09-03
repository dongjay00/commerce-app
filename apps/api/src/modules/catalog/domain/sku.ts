import type { SkuId } from '../../../shared/kernel/identifiers';
import type { Price } from './price';

/**
 * SKU 엔티티. **불변이다** — `withPrice`가 새 인스턴스를 돌려주고 `Product`가
 * 목록의 자리를 교체한다.
 *
 * 계획 2가 `SavedAddress`에서 배운 것을 처음부터 적용한다: 내부 엔티티에 public
 * 변경 메서드를 두면 애그리거트 밖에서 목록을 얻어 불변식을 깰 수 있고, "이건
 * 애그리거트만 부르세요"라는 주석은 그것을 막지 못한다. 타입 시스템이 막게 한다.
 */
export class Sku {
  private constructor(
    readonly id: SkuId,
    readonly code: string,
    readonly price: Price,
  ) {}

  static create(params: { id: SkuId; code: string; price: Price }): Sku {
    return new Sku(params.id, params.code, params.price);
  }

  static rehydrate(params: { id: SkuId; code: string; price: Price }): Sku {
    return new Sku(params.id, params.code, params.price);
  }

  withPrice(next: Price): Sku {
    return new Sku(this.id, this.code, next);
  }
}
