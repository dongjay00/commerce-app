import { ProductId, SkuId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import { Price } from '../domain/price';
import { Product } from '../domain/product';
import { Sku } from '../domain/sku';

/** 테스트 전반에서 쓰는 고정값. 여러 파일이 같은 값을 다시 타이핑하지 않게 모아둔다. */
export const FIXED_NOW = new Date('2026-03-01T10:00:00.000Z');

/**
 * UUID 리터럴은 반드시 유효한 16진수여야 하고 **마지막 그룹이 정확히 12자**여야 한다.
 * `SkuId.of` 등이 형식을 검증하므로 `cust`나 `prod` 같은 읽기 좋은 접두사를 넣거나
 * 길이를 어긋나게 하면 즉시 던진다 — 계획 2에서 브리프의 리터럴에 비-16진수가 들어가
 * 태스크가 한 번 막혔다. 구분이 필요하면 16진수 안에서 고른다: `a0` = product,
 * `5c` = sku. 접두사 6자 + 패딩된 접미사 6자 = 12자.
 */
const tail = (marker: string, suffix: string): string => `${marker}${suffix.padStart(6, '0')}`;

export const productUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0c1da0', suffix)}`;
export const skuUuid = (suffix: string): string =>
  `018f2b1c-4a5d-7e6f-8a9b-${tail('0c1d5c', suffix)}`;

/**
 * 테스트용 상품 빌더. 계약 스위트와 `FindSkuPricesService` spec이 공유한다 —
 * 각자 복사해 두면 둘이 서서히 갈라진다.
 */
export function aProduct(suffix: string, skuCount = 2): Product {
  const skus = Array.from({ length: skuCount }, (_, index) =>
    Sku.create({
      id: SkuId.of(skuUuid(`${suffix}${index}`)),
      code: `CODE-${index}`,
      price: Price.of(Money.of(BigInt(1000 + index * 100))),
    }),
  );
  return Product.register({
    id: ProductId.of(productUuid(`${suffix}0`)),
    name: `상품-${suffix}`,
    skus,
    now: FIXED_NOW,
  });
}
