import { describe, expect, it } from 'vitest';
import {
  productDtoSchema,
  registerProductBodySchema,
  searchProductsQuerySchema,
  updatePriceBodySchema,
} from './product.contract';

const PRICE = { amount: '1000', currency: 'KRW' as const };
const validBody = { name: '티셔츠', skus: [{ code: 'RED-M', price: PRICE }] };

describe('registerProductBodySchema', () => {
  it('정상 입력을 파싱한다', () => {
    expect(registerProductBodySchema.parse(validBody)).toEqual(validBody);
  });

  it('SKU가 빈 배열이면 거부한다', () => {
    // 형식 검증이다 — "빈 배열은 이 요청의 형태가 아니다". 의미(SKU 없는 상품은
    // 존재할 수 없다)는 Product.register가 따로 지킨다.
    expect(() => registerProductBodySchema.parse({ name: '티셔츠', skus: [] })).toThrow();
  });

  it('정규화되지 않은 금액 문자열을 거부한다', () => {
    // moneyDtoSchema가 선행 0을 막는다. 그 규칙이 이 계약에 실제로 연결됐는지 확인한다.
    expect(() =>
      registerProductBodySchema.parse({
        name: '티셔츠',
        skus: [{ code: 'X', price: { amount: '007', currency: 'KRW' } }],
      }),
    ).toThrow();
  });

  it('계약에 없는 필드를 거부한다', () => {
    expect(() => registerProductBodySchema.parse({ ...validBody, status: 'ACTIVE' })).toThrow();
  });

  it('SKU 안의 추가 필드도 거부한다', () => {
    expect(() =>
      registerProductBodySchema.parse({
        name: '티셔츠',
        skus: [{ code: 'X', price: PRICE, id: 'nope' }],
      }),
    ).toThrow();
  });
});

describe('productDtoSchema', () => {
  const dto = {
    id: '018f2b1c-4a5d-7e6f-8a9b-0c1da0000001',
    name: '티셔츠',
    status: 'ACTIVE' as const,
    skus: [{ id: '018f2b1c-4a5d-7e6f-8a9b-0c1d5c000001', code: 'RED-M', price: PRICE }],
  };

  it('정상 응답을 파싱한다', () => {
    expect(productDtoSchema.parse(dto)).toEqual(dto);
  });

  it('계약에 없는 필드를 거부한다', () => {
    // non-strict 스키마는 알 수 없는 키를 오류가 아니라 조용히 버린다 —
    // 드리프트가 한 방향으로만 잡힌다.
    expect(() => productDtoSchema.parse({ ...dto, internalCost: '500' })).toThrow();
  });

  it('알 수 없는 status를 거부한다', () => {
    expect(() => productDtoSchema.parse({ ...dto, status: 'DRAFT' })).toThrow();
  });
});

describe('updatePriceBodySchema', () => {
  it('가격만 받는다', () => {
    expect(updatePriceBodySchema.parse({ price: PRICE })).toEqual({ price: PRICE });
  });

  it('skuId 같은 추가 필드를 거부한다', () => {
    // 경로 파라미터로 오는 값이 본문으로도 들어오면 어느 쪽이 이기는지 모호해진다.
    expect(() => updatePriceBodySchema.parse({ price: PRICE, skuId: 'x' })).toThrow();
  });
});

describe('searchProductsQuerySchema', () => {
  it('문자열 쿼리 파라미터를 숫자로 강제 변환한다', () => {
    expect(searchProductsQuerySchema.parse({ limit: '5', offset: '10' })).toEqual({
      limit: 5,
      offset: 10,
    });
  });

  it('기본값을 채운다', () => {
    expect(searchProductsQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('limit 상한을 강제한다', () => {
    // 상한이 없으면 limit=1000000 한 방으로 DB를 훑게 된다.
    expect(() => searchProductsQuerySchema.parse({ limit: '1000' })).toThrow();
  });

  it('음수 offset을 거부한다', () => {
    expect(() => searchProductsQuerySchema.parse({ offset: '-1' })).toThrow();
  });
});
