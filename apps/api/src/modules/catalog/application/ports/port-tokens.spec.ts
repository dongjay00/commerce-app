import { describe, expect, it } from 'vitest';
import { FIND_SKU_PRICES_QUERY } from './in/queries/find-sku-prices.query';
import { GET_PRODUCT_QUERY } from './in/queries/get-product.query';
import { SEARCH_PRODUCTS_QUERY } from './in/queries/search-products.query';
import { REGISTER_PRODUCT_USECASE } from './in/register-product.usecase';
import { UPDATE_PRICE_USECASE } from './in/update-price.usecase';
import { PRODUCT_QUERY } from './out/product.query';
import { PRODUCT_REPOSITORY } from './out/product.repository';

/**
 * 포트 토큰 여섯 개를 값으로 임포트해 정체성을 고정한다.
 *
 * 두 가지를 동시에 한다. 하나는 커버리지다 — 포트 파일은 인터페이스와 `Symbol`
 * 하나가 전부라 `import type`으로만 쓰이면 런타임에 로드되지 않고, Vitest의
 * `coverage.all`이 켜져 있어 0%로 잡혀 application 임계값(90/85)을 실패시킨다.
 *
 * 다른 하나가 본론이다. Nest는 심볼의 **정체성**으로 의존성을 해석하므로
 * `product.query.ts`에 `Symbol('ProductRepository')`를 복붙해도 배선은 정상
 * 동작한다 — 다만 해석에 실패할 때 에러 메시지가 엉뚱한 포트 이름을 댄다.
 * 한 시간을 태우고 흔적도 안 남기는 함정이라 설명 문자열을 여기서 못박는다.
 */
describe('Catalog 포트 토큰', () => {
  const tokens: Array<{ token: symbol; name: string }> = [
    { token: PRODUCT_REPOSITORY, name: 'ProductRepository' },
    { token: PRODUCT_QUERY, name: 'ProductQuery' },
    { token: REGISTER_PRODUCT_USECASE, name: 'RegisterProductUseCase' },
    { token: UPDATE_PRICE_USECASE, name: 'UpdatePriceUseCase' },
    { token: GET_PRODUCT_QUERY, name: 'GetProductQuery' },
    { token: FIND_SKU_PRICES_QUERY, name: 'FindSkuPricesQuery' },
    { token: SEARCH_PRODUCTS_QUERY, name: 'SearchProductsQuery' },
  ];

  it.each(tokens)('$name 토큰은 심볼이고 설명이 포트 이름과 정확히 일치한다', ({ token, name }) => {
    expect(typeof token).toBe('symbol');
    expect(token.description).toBe(name);
  });

  it('여섯 토큰은 서로 다르다', () => {
    const unique = new Set(tokens.map((t) => t.token));
    expect(unique.size).toBe(tokens.length);
  });
});
