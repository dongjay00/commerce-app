import { addCartItemBodySchema, ErrorCode } from '@commerce/contracts';
import { apiBaseUrl } from '@/server/api-client';
import { handleBff, toResponse } from '@/server/bff-response';
import { addCartItemAction } from '@/server/cart-actions';
import { cookieTokenStore } from '@/server/session';

/**
 * 접착제. 로직은 전부 `addCartItemAction`에 있고 그쪽은 테스트가 있다.
 * 이 파일 자체에는 자동 테스트가 없다 — Route Handler를 vitest에서 부르려면
 * Next의 요청 컨텍스트가 필요하고 그걸 흉내내려면 목 라이브러리가 든다(금지).
 * 태스크 13~14의 Playwright E2E가 이 경로를 덮는다.
 */
export async function POST(request: Request): Promise<Response> {
  const body = addCartItemBodySchema.safeParse(await request.json());
  if (!body.success) {
    return Response.json(
      { code: ErrorCode.VALIDATION_FAILED, message: '입력값이 올바르지 않습니다.' },
      { status: 400 },
    );
  }
  return handleBff(async () =>
    toResponse(
      await addCartItemAction(body.data, {
        baseUrl: apiBaseUrl(),
        store: await cookieTokenStore(),
      }),
    ),
  );
}
