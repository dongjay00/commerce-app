import { apiBaseUrl } from '@/server/api-client';
import { handleBff, toResponse } from '@/server/bff-response';
import { cancelOrderAction } from '@/server/order-actions';
import { cookieTokenStore } from '@/server/session';

/**
 * 접착제. 로직은 전부 `cancelOrderAction`에 있고 그쪽은 테스트가 있다.
 * 이 파일 자체에는 자동 테스트가 없다 — Route Handler를 vitest에서 부르려면
 * Next의 요청 컨텍스트가 필요하고 그걸 흉내내려면 목 라이브러리가 든다(금지).
 * 태스크 13~14의 Playwright E2E가 이 경로를 덮는다.
 *
 * 취소는 본문이 없으므로 `request.json()`을 부르지 않는다.
 */
interface RouteContext {
  params: Promise<{ orderId: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { orderId } = await context.params;
  return handleBff(async () =>
    toResponse(
      await cancelOrderAction(orderId, {
        baseUrl: apiBaseUrl(),
        store: await cookieTokenStore(),
      }),
    ),
  );
}
