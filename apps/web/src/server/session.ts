import 'server-only';
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { SessionExpiredError } from './api-client';
import type { TokenStore, Tokens } from './token-store';

interface SessionData {
  tokens?: Tokens;
}

/**
 * `SESSION_PASSWORD`를 검증한다. `cookies()`에 기대지 않는 순수 함수라 vitest에서
 * 직접 테스트한다 (`session.spec.ts`) — `getIronSession`/`cookies()`에 의존하는
 * 나머지 부분과 분리한 이유가 이것이다.
 */
export function requireSessionPassword(env: Record<string, string | undefined>): string {
  const password = env['SESSION_PASSWORD'];
  if (!password || password.length < 32) {
    throw new Error('SESSION_PASSWORD가 없거나 32자 미만입니다. apps/web/.env.local을 확인하세요.');
  }
  return password;
}

/**
 * 스펙 §8.5가 요구하는 세 속성(HttpOnly, Secure, SameSite=Lax)을 담은 쿠키 옵션.
 * `cookies()`도 `getIronSession`도 필요 없는 `process.env`의 순수 함수라, 이 값을
 * 인자로 받게 해 `requireSessionPassword`와 같은 이유로 `session.spec.ts`가 직접
 * 검증한다 — 이 세 줄이 이 계층 전체가 존재하는 이유이므로, 커버리지 없는 부분에
 * 두면 안 된다.
 */
export function sessionOptions(env: Record<string, string | undefined>): SessionOptions {
  return {
    password: requireSessionPassword(env),
    cookieName: 'sid',
    cookieOptions: {
      // 스펙 §8.5: 브라우저 자바스크립트는 토큰을 볼 수 없다. XSS 노출면이 줄어든다.
      httpOnly: true,
      sameSite: 'lax',
      secure: env['NODE_ENV'] === 'production',
      path: '/',
    },
  };
}

/**
 * 암호화 쿠키를 `TokenStore`로 노출한다. Redis를 띄우지 않는 이유는 즉시 무효화가
 * 이미 Nest의 `sessions` 테이블에서 해결되기 때문이다 — BFF는 토큰 운반자일 뿐이라
 * 별도 저장소가 필요 없다.
 *
 * **`cookieTokenStore` 자체에는 vitest 단위 테스트가 없다.** `cookies()`는 Next의
 * 요청 컨텍스트 안에서만 동작하고, 그걸 흉내내려면 목 라이브러리가 필요하다(금지).
 * `requireSessionPassword`와 `sessionOptions`만은 `cookies()`에 기대지 않아
 * `session.spec.ts`가 직접 덮는다. 나머지 로직은 `api-client.ts`와 `auth-actions.ts`에
 * 있고 그쪽은 테스트가 있다.
 *
 * 실제 동작 중 **테스트가 덮는 것은 두 가지다**: 로그인 Route Handler가 쿠키를
 * 심고 이후 요청이 그것을 읽는다는 것(`e2e/auth.spec.ts` 등 열 개 시나리오 전부가
 * 이 경로 위에서 돈다)과, RSC 렌더 중 갱신이 필요해졌을 때 500이 아니라
 * 로그인 화면으로 끝난다는 것(`e2e/session.spec.ts`). 덮지 않는 것은
 * `sealData`/`unsealData`의 왕복 자체 — 그건 iron-session의 책임이다.
 */
export async function cookieTokenStore(): Promise<TokenStore> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions(process.env));

  return {
    async read(): Promise<Tokens | null> {
      return session.tokens ?? null;
    },
    async write(tokens: Tokens): Promise<void> {
      session.tokens = tokens;
      await persist(() => session.save());
    },
    async clear(): Promise<void> {
      await persist(() => {
        session.destroy();
      });
    },
  };
}

/**
 * Next는 **RSC 렌더 중의 쿠키 수정을 금지한다.** `cookies()`가 RSC에서 돌려주는
 * 스토어는 `set`/`delete`가 봉인돼 있어 `ReadonlyRequestCookiesError`를 던진다
 * (`Cookies can only be modified in a Server Action or Route Handler`).
 * Route Handler와 Server Action에서는 같은 호출이 정상 동작한다 — 이 비대칭이
 * 이 함수가 존재하는 이유다.
 *
 * 그래서 액세스 토큰 갱신(`api-client.ts`의 401 재시도)이 RSC에서 일어나면
 * 새 토큰을 쿠키에 담을 수 없다. 그때 **그냥 넘어가면 안 된다**: 리프레시 토큰은
 * 회전하고 옛것은 즉시 무효가 되므로
 * (`apps/api/.../refresh-session.service.spec.ts`의 "회전 후 옛 리프레시 토큰은
 * 더 이상 쓸 수 없다"), 삼키면 쿠키에 죽은 토큰이 남아 이후 모든 요청이 영구히
 * 실패한다. 한 번의 재로그인이 그것보다 낫다 — `SessionExpiredError`로 바꿔
 * 던져서 `app/cart/page.tsx`·`app/orders/[orderId]/page.tsx`의 기존
 * `redirect('/sign-in')`이 발동하게 한다.
 *
 * **제대로 된 해법은 갱신을 미들웨어로 옮기는 것이다.** Next 미들웨어는 쿠키를
 * 쓸 수 있으므로, 거기서 만료 임박 토큰을 선제 갱신하면 RSC는 항상 살아 있는
 * 액세스 토큰만 보게 되고 이 경로 자체가 사라진다. 계획서 부록의 이월 항목이다.
 */
async function persist(mutate: () => void | Promise<void>): Promise<void> {
  try {
    await mutate();
  } catch (error) {
    if (!isCookieWriteForbidden(error)) {
      throw error;
    }
    throw new SessionExpiredError(
      '이 렌더 컨텍스트에서는 세션 쿠키를 갱신할 수 없습니다. 다시 로그인해야 합니다.',
    );
  }
}

/**
 * "여기서는 쿠키를 쓸 수 없다"만 고른다. 다른 오류(봉인 실패, 쿠키 크기 초과 등)를
 * 세션 만료로 둔갑시키면 진짜 결함이 로그인 화면 뒤에 숨는다.
 *
 * Next는 이 오류에 `__NEXT_ERROR_CODE = 'E1180'`을 붙인다(열거되지 않는 속성이라
 * 직렬화에는 안 보인다). 코드가 바뀔 경우를 대비해 메시지도 함께 본다 — 둘 다
 * Next 내부라 어느 한쪽에만 기대는 것보다 낫다.
 */
function isCookieWriteForbidden(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code: unknown = (error as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE;
  return code === 'E1180' || error.message.includes('Cookies can only be modified');
}
