import 'server-only';
import { sessionTokensSchema } from '@commerce/contracts';
import { type ApiFetcher, type ApiFetcherArgs, tsRestFetchApi } from '@ts-rest/core';
import { createContractClient } from '../shared/api/contract-client';
import { readJsonBody } from './safe-json';
import type { TokenStore, Tokens } from './token-store';

/**
 * 세션이 없거나 되살릴 수 없다. 호출자(Route Handler, RSC)는 이걸 잡아 로그인으로 보낸다.
 */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

function withToken(args: ApiFetcherArgs, accessToken: string): ApiFetcherArgs {
  return { ...args, headers: { ...args.headers, authorization: `Bearer ${accessToken}` } };
}

async function refreshTokens(baseUrl: string, refreshToken: string): Promise<Tokens | null> {
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    return null;
  }
  // 계약 스키마로 파싱한다. 서버가 형태를 바꾸면 여기서 즉시 깨진다 —
  // undefined 토큰을 헤더에 실어 보내는 것보다 낫다. 본문이 JSON조차 아니면
  // (프록시의 HTML 502 등) readJsonBody가 null을 돌려주고 여기서 그대로 실패한다.
  const parsed = sessionTokensSchema.safeParse(await readJsonBody(response));
  if (!parsed.success) {
    return null;
  }
  return { accessToken: parsed.data.accessToken, refreshToken: parsed.data.refreshToken };
}

/**
 * 스펙 §8.5의 두 번째 흐름: 쿠키 → 토큰 주입 → 401이면 갱신 후 **정확히 1회** 재시도.
 *
 * 재시도가 1회인 것이 중요하다. 조건 없이 반복하면 API가 계속 401을 내는 상황에서
 * 무한 루프가 된다. 갱신 후에도 401이면 세션을 버리고 로그인으로 보낸다.
 *
 * 401이 아닌 오류(500 등)에는 갱신하지 않는다. 멀쩡한 리프레시 토큰을 회전시켜
 * 태울 이유가 없다.
 */
export function createAuthenticatedApi(baseUrl: string, store: TokenStore): ApiFetcher {
  return async (args: ApiFetcherArgs) => {
    const tokens = await store.read();
    if (tokens === null) {
      throw new SessionExpiredError('세션이 없습니다.');
    }

    const first = await tsRestFetchApi(withToken(args, tokens.accessToken));
    if (first.status !== 401) {
      return first;
    }

    const refreshed = await refreshTokens(baseUrl, tokens.refreshToken);
    if (refreshed === null) {
      await store.clear();
      throw new SessionExpiredError('세션 갱신에 실패했습니다.');
    }
    await store.write(refreshed);

    const second = await tsRestFetchApi(withToken(args, refreshed.accessToken));
    if (second.status === 401) {
      await store.clear();
      throw new SessionExpiredError('갱신 후에도 인증에 실패했습니다.');
    }
    return second;
  };
}

export function createApiClient(baseUrl: string, store: TokenStore) {
  return createContractClient(baseUrl, createAuthenticatedApi(baseUrl, store));
}

export function apiBaseUrl(): string {
  return process.env['API_BASE_URL'] ?? 'http://localhost:3001';
}
