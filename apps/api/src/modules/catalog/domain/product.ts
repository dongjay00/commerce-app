import type { ProductId, SkuId } from '../../../shared/kernel/identifiers';
import {
  CorruptedProductError,
  DuplicateSkuCodeError,
  InvalidProductError,
  SkuNotFoundError,
} from './catalog.errors';
import type { Price } from './price';
import type { Sku } from './sku';

/**
 * 상태 전이 메서드를 두지 않는다 — 스펙 §7.6의 인바운드 목록에 상태를 바꾸는
 * 유스케이스가 없다. `'ARCHIVED'`는 `rehydrate`로만 만들어지고, 검색이 그 값을
 * 걸러내는지 확인하는 데 쓰인다.
 */
export type ProductStatus = 'ACTIVE' | 'ARCHIVED';

/** 코드가 중복된 첫 SKU의 코드를 돌려준다. 중복이 없으면 `null`. */
function findDuplicateCode(skus: readonly Sku[]): string | null {
  const seen = new Set<string>();
  for (const sku of skus) {
    if (seen.has(sku.code)) {
      return sku.code;
    }
    seen.add(sku.code);
  }
  return null;
}

/**
 * 상품 애그리거트 루트.
 *
 * `AggregateRoot`를 상속하지 않는다 — 스펙 §5.6의 이벤트 목록에 catalog가 발행하는
 * 이벤트가 없다. 상속만 해두면 리포지토리가 매번 빈 `pullEvents()`를 부르는 죽은
 * 배관이 남는다. 계획 2의 `Customer`와 같은 판단이다.
 */
export class Product {
  private constructor(
    readonly id: ProductId,
    readonly name: string,
    readonly status: ProductStatus,
    private readonly items: Sku[],
    readonly createdAt: Date,
  ) {}

  static register(params: { id: ProductId; name: string; skus: Sku[]; now: Date }): Product {
    const name = params.name.trim();
    if (name.length === 0) {
      throw new InvalidProductError('이름이 비어 있습니다');
    }
    if (params.skus.length === 0) {
      throw new InvalidProductError('SKU가 하나도 없습니다');
    }
    const duplicate = findDuplicateCode(params.skus);
    if (duplicate !== null) {
      throw new DuplicateSkuCodeError(duplicate);
    }
    // 배열을 복사한다. 호출자가 나중에 push해도 상품이 따라 바뀌면 안 된다.
    return new Product(params.id, name, 'ACTIVE', [...params.skus], params.now);
  }

  static rehydrate(params: {
    id: ProductId;
    name: string;
    status: ProductStatus;
    skus: Sku[];
    createdAt: Date;
  }): Product {
    // 복원 경로의 위반은 데이터 손상이므로 DomainError가 아니다 — 500이 정직하다.
    if (params.skus.length === 0) {
      throw new CorruptedProductError(params.id, 'SKU가 하나도 없습니다');
    }
    const duplicate = findDuplicateCode(params.skus);
    if (duplicate !== null) {
      throw new CorruptedProductError(params.id, `SKU 코드가 중복됩니다: ${duplicate}`);
    }
    return new Product(params.id, params.name, params.status, [...params.skus], params.createdAt);
  }

  get skus(): readonly Sku[] {
    return this.items;
  }

  findSku(skuId: SkuId): Sku {
    const found = this.items.find((sku) => sku.id === skuId);
    if (found === undefined) {
      throw new SkuNotFoundError(skuId);
    }
    return found;
  }

  /** `Sku`가 불변이므로 목록의 자리를 새 인스턴스로 교체한다. */
  changePrice(skuId: SkuId, price: Price): void {
    const current = this.findSku(skuId);
    this.items[this.items.indexOf(current)] = current.withPrice(price);
  }
}
