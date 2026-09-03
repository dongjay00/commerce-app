import { addressBodySchema, addressContract } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { anAddressDto } from '../fixtures';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

// 라우트 이름은 `addressContract`의 것이다: list / add / update / remove / setDefault.
export const addressHandlers = [
  http.get(`${BASE}/addresses`, () =>
    HttpResponse.json(addressContract.list.responses[200].parse({ addresses: [anAddressDto()] })),
  ),
  http.post(`${BASE}/addresses`, async ({ request }) => {
    addressBodySchema.parse(await request.json());
    return HttpResponse.json(addressContract.add.responses[201].parse(anAddressDto()), {
      status: 201,
    });
  }),
];
