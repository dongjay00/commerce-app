import { apiBaseUrl } from '@/server/api-client';
import { signInAction } from '@/server/auth-actions';
import { cookieTokenStore } from '@/server/session';

/**
 * 접착제 3줄. 로직은 전부 `signInAction`에 있고 그쪽은 테스트가 있다.
 * 이 파일 자체에는 자동 테스트가 없다 — Route Handler를 vitest에서 부르려면
 * Next의 요청 컨텍스트가 필요하고, 그걸 흉내내려면 목 라이브러리가 든다(금지).
 * 다음 계획의 Playwright E2E가 이 경로를 덮는다.
 */
export async function POST(request: Request): Promise<Response> {
  const result = await signInAction(await request.json(), {
    baseUrl: apiBaseUrl(),
    store: await cookieTokenStore(),
  });
  return Response.json(result, { status: result.ok ? 200 : 401 });
}
