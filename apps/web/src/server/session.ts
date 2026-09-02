import 'server-only';
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import type { TokenStore, Tokens } from './token-store';

interface SessionData {
  tokens?: Tokens;
}

function sessionOptions(): SessionOptions {
  const password = process.env['SESSION_PASSWORD'];
  if (!password || password.length < 32) {
    throw new Error('SESSION_PASSWORD가 없거나 32자 미만입니다. apps/web/.env.local을 확인하세요.');
  }
  return {
    password,
    cookieName: 'sid',
    cookieOptions: {
      // 스펙 §8.5: 브라우저 자바스크립트는 토큰을 볼 수 없다. XSS 노출면이 줄어든다.
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
  };
}

/**
 * 암호화 쿠키를 `TokenStore`로 노출한다. Redis를 띄우지 않는 이유는 즉시 무효화가
 * 이미 Nest의 `sessions` 테이블에서 해결되기 때문이다 — BFF는 토큰 운반자일 뿐이라
 * 별도 저장소가 필요 없다.
 *
 * **이 파일에는 자동 테스트가 없다.** `cookies()`는 Next의 요청 컨텍스트 안에서만
 * 동작하고, 그걸 흉내내려면 목 라이브러리가 필요하다(금지). 대신 이 파일을 3~4줄로
 * 유지하고 로직 전체를 `api-client.ts`와 `auth-actions.ts`에 두어, 테스트되지 않는
 * 표면을 최소화했다. 실제 동작은 다음 계획의 Playwright E2E가 확인한다.
 */
export async function cookieTokenStore(): Promise<TokenStore> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions());

  return {
    async read(): Promise<Tokens | null> {
      return session.tokens ?? null;
    },
    async write(tokens: Tokens): Promise<void> {
      session.tokens = tokens;
      await session.save();
    },
    async clear(): Promise<void> {
      session.destroy();
    },
  };
}
