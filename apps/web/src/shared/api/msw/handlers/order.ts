import { orderContract, placeOrderBodySchema } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { anOrderDto, ORDER_ID } from '../fixtures';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

export const orderHandlers = [
  http.post(`${BASE}/orders`, async ({ request }) => {
    placeOrderBodySchema.parse(await request.json());
    return HttpResponse.json(
      orderContract.place.responses[201].parse({ orderId: ORDER_ID, status: 'PAID' }),
      { status: 201 },
    );
  }),
  http.get(`${BASE}/orders/${ORDER_ID}`, () =>
    HttpResponse.json(orderContract.get.responses[200].parse(anOrderDto())),
  ),
  http.post(`${BASE}/orders/${ORDER_ID}/cancel`, () =>
    HttpResponse.json(orderContract.cancel.responses[200].parse({ status: 'REFUND_PENDING' })),
  ),
];
