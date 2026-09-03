import { apiBaseUrl } from '@/server/api-client';
import { createContractClient } from '@/shared/api/contract-client';
import { ProductListView } from '@/views/product-list';

/**
 * 상품 목록은 인증이 필요 없다 — 계획 3의 `ProductController`가 조회에 가드를 걸지
 * 않았다. 그래서 `createApiClient`(인증)가 아니라 `createContractClient`(비인증)를
 * 쓴다. 전자는 세션이 없으면 `SessionExpiredError`를 던지므로, 로그인하지 않은
 * 방문자가 상품 목록조차 볼 수 없게 된다.
 *
 * `createContractClient`를 `@/shared/api/contract-client`에서 가져온다 — `app/`은
 * FSD 밖이라 `shared`를 직접 써도 레이어 규칙에 걸리지 않는다.
 */
export default async function HomePage() {
  const client = createContractClient(apiBaseUrl());
  const result = await client.product.search({ query: { limit: 20, offset: 0 } });
  if (result.status !== 200) {
    return <p role="alert">상품을 불러오지 못했습니다.</p>;
  }
  return <ProductListView products={result.body.products} />;
}
