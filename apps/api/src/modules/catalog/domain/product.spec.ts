import { describe, expect, it } from 'vitest';
import { ProductId, SkuId } from '../../../shared/kernel/identifiers';
import { Money } from '../../../shared/kernel/money';
import {
  CorruptedProductError,
  DuplicateSkuCodeError,
  InvalidProductError,
  SkuNotFoundError,
} from './catalog.errors';
import { Price } from './price';
import { Product } from './product';
import { Sku } from './sku';

const PRODUCT_ID = ProductId.of('018f2b1c-4a5d-7e6f-8a9b-0c1da0000001');
const SKU_A = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000001');
const SKU_B = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c000002');
const MISSING_SKU = SkuId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d5c009999');
const NOW = new Date('2026-03-01T10:00:00.000Z');

function sku(id = SKU_A, code = 'RED-M', amount = 1000n): Sku {
  return Sku.create({ id, code, price: Price.of(Money.of(amount)) });
}

describe('Product.register', () => {
  it('상품과 SKU 목록을 만든다', () => {
    const product = Product.register({
      id: PRODUCT_ID,
      name: '티셔츠',
      skus: [sku(SKU_A, 'RED-M'), sku(SKU_B, 'RED-L', 1200n)],
      now: NOW,
    });
    expect(product.name).toBe('티셔츠');
    expect(product.skus.map((s) => s.code)).toEqual(['RED-M', 'RED-L']);
  });

  it('ACTIVE 상태로 만들어진다', () => {
    // 상태를 바꾸는 유스케이스가 없으므로(스펙 §7.6) 등록 즉시 판매 가능해야 한다.
    expect(
      Product.register({ id: PRODUCT_ID, name: '티셔츠', skus: [sku()], now: NOW }).status,
    ).toBe('ACTIVE');
  });

  it('생성 시각을 주입된 값으로 쓴다 — new Date()를 부르지 않는다', () => {
    expect(
      Product.register({ id: PRODUCT_ID, name: '티셔츠', skus: [sku()], now: NOW }).createdAt,
    ).toEqual(NOW);
  });

  it('이름의 앞뒤 공백을 제거한다', () => {
    expect(
      Product.register({ id: PRODUCT_ID, name: '  티셔츠  ', skus: [sku()], now: NOW }).name,
    ).toBe('티셔츠');
  });

  it('빈 이름을 거부한다', () => {
    expect(() =>
      Product.register({ id: PRODUCT_ID, name: '   ', skus: [sku()], now: NOW }),
    ).toThrow(InvalidProductError);
  });

  it('SKU가 하나도 없으면 거부한다', () => {
    // SKU 없는 상품은 살 수 없다. 재고도 가격도 SKU에 붙는다.
    expect(() => Product.register({ id: PRODUCT_ID, name: '티셔츠', skus: [], now: NOW })).toThrow(
      InvalidProductError,
    );
  });

  it('SKU 코드가 중복되면 거부한다', () => {
    expect(() =>
      Product.register({
        id: PRODUCT_ID,
        name: '티셔츠',
        skus: [sku(SKU_A, 'RED-M'), sku(SKU_B, 'RED-M')],
        now: NOW,
      }),
    ).toThrow(DuplicateSkuCodeError);
  });

  it('SKU 목록을 복사한다 — 원본 배열을 나중에 바꿔도 상품은 안 바뀐다', () => {
    const skus = [sku()];
    const product = Product.register({ id: PRODUCT_ID, name: '티셔츠', skus, now: NOW });
    skus.push(sku(SKU_B, 'RED-L'));
    expect(product.skus).toHaveLength(1);
  });
});

describe('Product.findSku', () => {
  const product = Product.register({
    id: PRODUCT_ID,
    name: '티셔츠',
    skus: [sku(SKU_A, 'RED-M'), sku(SKU_B, 'RED-L', 1200n)],
    now: NOW,
  });

  it('ID로 SKU를 찾는다', () => {
    expect(product.findSku(SKU_B).code).toBe('RED-L');
  });

  it('없는 SKU면 SkuNotFoundError다', () => {
    expect(() => product.findSku(MISSING_SKU)).toThrow(SkuNotFoundError);
  });
});

describe('Product.changePrice', () => {
  function aProduct(): Product {
    return Product.register({
      id: PRODUCT_ID,
      name: '티셔츠',
      skus: [sku(SKU_A, 'RED-M'), sku(SKU_B, 'RED-L', 1200n)],
      now: NOW,
    });
  }

  it('지정한 SKU의 가격만 바꾼다', () => {
    const product = aProduct();
    product.changePrice(SKU_A, Price.of(Money.of(1800n)));

    expect(product.findSku(SKU_A).price.money.amount).toBe(1800n);
    expect(product.findSku(SKU_B).price.money.amount).toBe(1200n);
  });

  it('SKU의 코드와 ID는 그대로다', () => {
    const product = aProduct();
    product.changePrice(SKU_A, Price.of(Money.of(1800n)));
    expect(product.findSku(SKU_A).code).toBe('RED-M');
  });

  it('없는 SKU면 SkuNotFoundError이고 다른 가격은 그대로다', () => {
    const product = aProduct();
    expect(() => product.changePrice(MISSING_SKU, Price.of(Money.of(1800n)))).toThrow(
      SkuNotFoundError,
    );
    expect(product.findSku(SKU_A).price.money.amount).toBe(1000n);
  });
});

describe('Product.rehydrate', () => {
  it('저장된 상태를 그대로 복원한다', () => {
    const product = Product.rehydrate({
      id: PRODUCT_ID,
      name: '티셔츠',
      status: 'ARCHIVED',
      skus: [
        Sku.rehydrate({ id: SKU_A, code: 'RED-M', price: Price.fromPersistence(1000n, 'KRW') }),
      ],
      createdAt: NOW,
    });
    expect(product.status).toBe('ARCHIVED');
    expect(product.skus).toHaveLength(1);
  });

  it('SKU가 없는 저장 행은 CorruptedProductError다 — DomainError가 아니다', () => {
    // 정상 경로로는 불가능하다(register가 막는다). 도달했다면 데이터가 깨진 것이므로 500이다.
    expect(() =>
      Product.rehydrate({
        id: PRODUCT_ID,
        name: '티셔츠',
        status: 'ACTIVE',
        skus: [],
        createdAt: NOW,
      }),
    ).toThrow(CorruptedProductError);
  });

  it('코드가 중복된 저장 행도 CorruptedProductError다', () => {
    expect(() =>
      Product.rehydrate({
        id: PRODUCT_ID,
        name: '티셔츠',
        status: 'ACTIVE',
        skus: [
          Sku.rehydrate({ id: SKU_A, code: 'RED-M', price: Price.fromPersistence(1000n, 'KRW') }),
          Sku.rehydrate({ id: SKU_B, code: 'RED-M', price: Price.fromPersistence(1000n, 'KRW') }),
        ],
        createdAt: NOW,
      }),
    ).toThrow(CorruptedProductError);
  });
});
