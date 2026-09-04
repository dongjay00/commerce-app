import { addCartItemBodySchema, cartContract, changeCartItemBodySchema } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { aCartDto } from '../fixtures';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

export const cartHandlers = [
  http.get(`${BASE}/cart`, () =>
    HttpResponse.json(cartContract.get.responses[200].parse(aCartDto())),
  ),
  http.post(`${BASE}/cart/items`, async ({ request }) => {
    // 요청이 계약을 벗어나면 여기서 던진다 — 훅이 잘못된 본문을 보내는 회귀를 잡는다.
    addCartItemBodySchema.parse(await request.json());
    return new HttpResponse(null, { status: 204 });
  }),
  http.put(`${BASE}/cart/items/:skuId`, async ({ request }) => {
    changeCartItemBodySchema.parse(await request.json());
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete(`${BASE}/cart/items/:skuId`, () => new HttpResponse(null, { status: 204 })),
];
