import { productContract } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { aProductDto, PRODUCT_ID } from '../fixtures';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

/**
 * **응답을 계약 스키마로 파싱한 뒤 돌려준다.** 픽스처가 계약에서 벗어나면 목이
 * 즉시 깨진다 — 손으로 만든 fake는 조용히 드리프트하지만 이 방식은 구조적으로
 * 불가능하다(스펙 §9.9).
 */
export const productHandlers = [
  http.get(`${BASE}/products`, () =>
    HttpResponse.json(productContract.search.responses[200].parse({ products: [aProductDto()] })),
  ),
  http.get(`${BASE}/products/${PRODUCT_ID}`, () =>
    HttpResponse.json(productContract.get.responses[200].parse(aProductDto())),
  ),
];
