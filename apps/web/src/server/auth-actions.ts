import {
  ErrorCode,
  errorDtoSchema,
  type SignInBody,
  sessionTokensSchema,
} from '@commerce/contracts';
import { readJsonBody } from './safe-json';
import type { TokenStore } from './token-store';

export interface AuthDeps {
  readonly baseUrl: string;
  readonly store: TokenStore;
}

export type SignInResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

const SHAPE_MISMATCH_MESSAGE = '서버 응답 형식이 올바르지 않습니다.';

/**
 * Nest의 `/auth/sign-in`을 호출해 토큰을 받고 `TokenStore`(암호화 쿠키)에 저장한다.
 * 반환값에는 토큰이 없다 — 브라우저는 액세스 토큰을 절대 보지 않는다 (스펙 §8.5).
 */
export async function signInAction(input: SignInBody, deps: AuthDeps): Promise<SignInResult> {
  const response = await fetch(`${deps.baseUrl}/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  // 본문이 JSON조차 아니면(프록시의 HTML 502 등) readJsonBody가 null을 돌려주고,
  // 아래 스키마 파싱이 "계약과 다른 응답"과 동일한 경로로 실패한다.
  const body: unknown = await readJsonBody(response);

  if (response.ok) {
    const parsed = sessionTokensSchema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, code: ErrorCode.INTERNAL_ERROR, message: SHAPE_MISMATCH_MESSAGE };
    }
    await deps.store.write({
      accessToken: parsed.data.accessToken,
      refreshToken: parsed.data.refreshToken,
    });
    return { ok: true };
  }

  const parsedError = errorDtoSchema.safeParse(body);
  if (!parsedError.success) {
    return { ok: false, code: ErrorCode.INTERNAL_ERROR, message: SHAPE_MISMATCH_MESSAGE };
  }
  return { ok: false, code: parsedError.data.code, message: parsedError.data.message };
}

/**
 * Nest의 `/auth/sign-out`에 리프레시 토큰 폐기를 알린 뒤 로컬 세션을 비운다.
 * Nest 호출이 실패해도(서버 다운 등) 로컬 세션은 반드시 비운다 — 그렇지 않으면
 * 브라우저는 로그아웃했다고 믿는데 쿠키에는 여전히 토큰이 남는다.
 */
export async function signOutAction(deps: AuthDeps): Promise<{ ok: true }> {
  const tokens = await deps.store.read();
  if (tokens !== null) {
    try {
      await fetch(`${deps.baseUrl}/auth/sign-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
    } catch {
      // 의도적으로 무시한다: 서버가 죽었어도 아래 clear()는 반드시 실행된다.
    }
  }
  await deps.store.clear();
  return { ok: true };
}
