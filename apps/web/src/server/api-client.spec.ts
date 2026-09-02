import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../shared/api/msw/server';
import { createApiClient, SessionExpiredError } from './api-client';
import { InMemoryTokenStore } from './testing/in-memory-token-store';

const BASE = 'http://api.test';

let refreshCalls: number;
let seenAuthorization: string[];

beforeEach(() => {
  refreshCalls = 0;
  seenAuthorization = [];
});

/** 지정한 순서대로 주소록 응답을 돌려주는 핸들러. */
function addressesReturning(...statuses: number[]): void {
  let index = 0;
  server.use(
    http.get(`${BASE}/addresses`, ({ request }) => {
      seenAuthorization.push(request.headers.get('authorization') ?? '');
      const status = statuses[Math.min(index, statuses.length - 1)] ?? 200;
      index += 1;
      return status === 200
        ? HttpResponse.json({ addresses: [] }, { status: 200 })
        : HttpResponse.json({ code: 'UNAUTHENTICATED', message: '만료' }, { status });
    }),
  );
}

function refreshReturning(status: number): void {
  server.use(
    http.post(`${BASE}/auth/refresh`, () => {
      refreshCalls += 1;
      return status === 200
        ? HttpResponse.json(
            { accessToken: 'access-2', refreshToken: 'refresh-2', expiresInSeconds: 900 },
            { status: 200 },
          )
        : HttpResponse.json({ code: 'UNAUTHENTICATED', message: '만료' }, { status });
    }),
  );
}

describe('createApiClient', () => {
  it('액세스 토큰을 Authorization 헤더로 주입한다', async () => {
    addressesReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const response = await createApiClient(BASE, store).address.list();

    expect(response.status).toBe(200);
    expect(seenAuthorization).toEqual(['Bearer access-1']);
  });

  it('200이면 갱신하지 않는다', async () => {
    addressesReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await createApiClient(BASE, store).address.list();

    expect(refreshCalls).toBe(0);
  });

  it('401이면 갱신하고 새 토큰으로 정확히 한 번 재시도한다', async () => {
    // 스펙 §8.5의 "401이면 refresh로 갱신 후 1회 재시도 (BFF 안에서 조용히)".
    addressesReturning(401, 200);
    refreshReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const response = await createApiClient(BASE, store).address.list();

    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(seenAuthorization).toEqual(['Bearer access-1', 'Bearer access-2']);
  });

  it('갱신에 성공하면 새 토큰을 저장한다', async () => {
    // 저장하지 않으면 다음 요청이 또 401 → 갱신을 반복한다. 회전 때문에 그 갱신은
    // 실패하고, 사용자는 매 요청마다 로그아웃된다.
    addressesReturning(401, 200);
    refreshReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await createApiClient(BASE, store).address.list();

    expect(store.writes).toEqual([{ accessToken: 'access-2', refreshToken: 'refresh-2' }]);
  });

  it('갱신에 실패하면 세션을 지우고 SessionExpiredError를 던진다', async () => {
    addressesReturning(401);
    refreshReturning(401);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await expect(createApiClient(BASE, store).address.list()).rejects.toThrow(SessionExpiredError);
    expect(store.clearCalls).toBe(1);
    expect(await store.read()).toBeNull();
  });

  it('갱신 후에도 401이면 다시 갱신하지 않는다', async () => {
    // 무한 재시도 루프를 막는 단언이다. 이것이 없으면 API가 계속 401을 내는 상황에서
    // BFF가 갱신-재시도를 영원히 반복한다.
    addressesReturning(401, 401);
    refreshReturning(200);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await expect(createApiClient(BASE, store).address.list()).rejects.toThrow(SessionExpiredError);
    expect(refreshCalls).toBe(1);
    expect(seenAuthorization).toHaveLength(2);
    expect(store.clearCalls).toBe(1);
  });

  it('세션이 없으면 요청 자체를 보내지 않는다', async () => {
    addressesReturning(200);
    const store = new InMemoryTokenStore(null);

    await expect(createApiClient(BASE, store).address.list()).rejects.toThrow(SessionExpiredError);
    expect(seenAuthorization).toEqual([]);
  });

  it('401이 아닌 오류(500)는 갱신하지 않고 그대로 돌려준다', async () => {
    // 500에 갱신을 시도하면 멀쩡한 세션을 회전시켜 태우게 된다.
    addressesReturning(500);
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const response = await createApiClient(BASE, store).address.list();

    expect(response.status).toBe(500);
    expect(refreshCalls).toBe(0);
  });

  it('갱신 응답이 200인데 JSON이 아니면 세션을 지운다', async () => {
    // response.json()이 예외를 던지면 안 된다 — 프록시가 200과 함께 비-JSON 본문을
    // 돌려주는 경우에도 계약과 다른 응답과 같은 경로(세션 폐기)로 처리한다.
    addressesReturning(401);
    server.use(
      http.post(
        `${BASE}/auth/refresh`,
        () => new HttpResponse('<html>not json</html>', { status: 200 }),
      ),
    );
    const store = new InMemoryTokenStore({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await expect(createApiClient(BASE, store).address.list()).rejects.toThrow(SessionExpiredError);
    expect(store.clearCalls).toBe(1);
  });
});
