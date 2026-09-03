import { describe, expect, it } from 'vitest';
import { ProductId, SkuId } from '../../../../shared/kernel/identifiers';
import { Money } from '../../../../shared/kernel/money';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import {
  InvalidPriceError,
  ProductNotFoundError,
  SkuNotFoundError,
} from '../../domain/catalog.errors';
import { Price } from '../../domain/price';
import { Product } from '../../domain/product';
import { Sku } from '../../domain/sku';
import { FIXED_NOW, productUuid, skuUuid } from '../../testing/catalog.fixtures';
import { InMemoryProductRepository } from '../../testing/in-memory-product.repository';
import { UpdatePriceService } from './update-price.service';

const PRODUCT_ID = productUuid('1');
const SKU_A = skuUuid('1');
const SKU_B = skuUuid('2');
const MISSING_PRODUCT = productUuid('9999');
const MISSING_SKU = skuUuid('9999');

async function build() {
  const products = new InMemoryProductRepository();
  const service = new UpdatePriceService(products, new PassthroughTransactionManager());
  await products.save(
    Product.register({
      id: ProductId.of(PRODUCT_ID),
      name: '티셔츠',
      skus: [
        Sku.create({ id: SkuId.of(SKU_A), code: 'RED-M', price: Price.of(Money.of(1000n)) }),
        Sku.create({ id: SkuId.of(SKU_B), code: 'RED-L', price: Price.of(Money.of(1200n)) }),
      ],
      now: FIXED_NOW,
    }),
  );
  return { service, products };
}

const price = (amount: string) => ({ amount, currency: 'KRW' as const });

describe('UpdatePriceService', () => {
  it('지정한 SKU의 가격만 바꾸고 저장본에 반영된다', async () => {
    // 메모리 인스턴스가 아니라 리포지토리를 다시 읽어 확인한다 — save를 빠뜨려도
    // 메모리 객체는 바뀌어 있으므로 그것만 보면 통과한다.
    const { service, products } = await build();
    await service.execute({ productId: PRODUCT_ID, skuId: SKU_A, price: price('1800') });

    const saved = await products.findById(ProductId.of(PRODUCT_ID));
    expect(saved?.findSku(SkuId.of(SKU_A)).price.money.amount).toBe(1800n);
    expect(saved?.findSku(SkuId.of(SKU_B)).price.money.amount).toBe(1200n);
  });

  it('없는 상품이면 ProductNotFoundError다', async () => {
    const { service } = await build();
    await expect(
      service.execute({ productId: MISSING_PRODUCT, skuId: SKU_A, price: price('1800') }),
    ).rejects.toThrow(ProductNotFoundError);
  });

  it('없는 SKU면 SkuNotFoundError이고 저장본은 그대로다', async () => {
    const { service, products } = await build();
    await expect(
      service.execute({ productId: PRODUCT_ID, skuId: MISSING_SKU, price: price('1800') }),
    ).rejects.toThrow(SkuNotFoundError);

    const saved = await products.findById(ProductId.of(PRODUCT_ID));
    expect(saved?.findSku(SkuId.of(SKU_A)).price.money.amount).toBe(1000n);
  });

  it('0원이면 InvalidPriceError이고 저장본은 그대로다', async () => {
    const { service, products } = await build();
    await expect(
      service.execute({ productId: PRODUCT_ID, skuId: SKU_A, price: price('0') }),
    ).rejects.toThrow(InvalidPriceError);

    const saved = await products.findById(ProductId.of(PRODUCT_ID));
    expect(saved?.findSku(SkuId.of(SKU_A)).price.money.amount).toBe(1000n);
  });
});
