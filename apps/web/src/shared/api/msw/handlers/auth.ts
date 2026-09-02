import { signInBodySchema, signUpBodySchema } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

/**
 * 요청 본문을 계약 스키마로 파싱한다 — 계약이 바뀌면 프론트 목이 즉시 깨진다.
 * 손으로 만든 fake는 조용히 드리프트하지만 이 방식은 구조적으로 불가능하다 (스펙 §9.9).
 */
export const authHandlers = [
  http.post(`${BASE}/auth/sign-up`, async ({ request }) => {
    signUpBodySchema.parse(await request.json());
    return HttpResponse.json(
      { accessToken: 'msw-access', refreshToken: 'msw-refresh', expiresInSeconds: 900 },
      { status: 201 },
    );
  }),
  http.post(`${BASE}/auth/sign-in`, async ({ request }) => {
    signInBodySchema.parse(await request.json());
    return HttpResponse.json(
      { accessToken: 'msw-access', refreshToken: 'msw-refresh', expiresInSeconds: 900 },
      { status: 200 },
    );
  }),
];
