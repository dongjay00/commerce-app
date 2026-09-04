import { HttpResponse, http } from 'msw';
import { anAddressDto, ORDER_ID } from '../fixtures';

/**
 * **우리 Route Handler를 가로챈다** — Nest가 아니다. 훅 테스트의 seam이 여기다.
 *
 * 상대 경로를 쓰는 이유: 브라우저(jsdom)에서 훅이 `fetch('/api/...')`를 부르고,
 * MSW가 `location.origin`을 기준으로 해석한다.
 *
 * 응답을 계약 스키마로 파싱하지 않는다 — 이것은 **우리 BFF의 응답 형태**이고
 * `@commerce/contracts`가 정의하지 않는다. 대신 `bff-response.ts`가 그 형태의
 * 단일 출처이고 `bff-response.spec.ts`가 그것을 고정한다.
 */
export const bffHandlers = [
  http.post('/api/auth/sign-in', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/auth/sign-out', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/cart/items', () => new HttpResponse(null, { status: 204 })),
  http.put('/api/cart/items/:skuId', () => new HttpResponse(null, { status: 204 })),
  http.delete('/api/cart/items/:skuId', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/addresses', () => HttpResponse.json(anAddressDto(), { status: 200 })),
  http.post('/api/orders', () =>
    HttpResponse.json({ orderId: ORDER_ID, status: 'PAID' }, { status: 200 }),
  ),
  http.post('/api/orders/:orderId/cancel', () =>
    HttpResponse.json({ status: 'REFUND_PENDING' }, { status: 200 }),
  ),
];
