import { ErrorCode } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../shared/api/msw/server';
import { signInAction, signOutAction } from './auth-actions';
import { InMemoryTokenStore } from './testing/in-memory-token-store';

const BASE = 'http://api.test';
const CREDENTIALS = { email: 'user@example.com', password: 'correct horse battery' };

describe('signInAction', () => {
  it('성공하면 토큰을 저장하고 ok를 돌려준다', async () => {
    server.use(
      http.post(`${BASE}/auth/sign-in`, () =>
        HttpResponse.json(
          { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 },
          { status: 200 },
        ),
      ),
    );
    const store = new InMemoryTokenStore(null);

    const result = await signInAction(CREDENTIALS, { baseUrl: BASE, store });

    expect(result).toEqual({ ok: true });
    expect(await store.read()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('토큰을 응답 본문에 실어 돌려주지 않는다', async () => {
    // 이것이 스펙 §8.5의 요점이다. 브라우저는 액세스 토큰을 한 번도 보지 않는다.
    server.use(
      http.post(`${BASE}/auth/sign-in`, () =>
        HttpResponse.json(
          { accessToken: 'a', refreshToken: 'r', expiresInSeconds: 900 },
          { status: 200 },
        ),
      ),
    );
    const result = await signInAction(CREDENTIALS, {
      baseUrl: BASE,
      store: new InMemoryTokenStore(null),
    });
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('실패하면 에러 코드를 그대로 전달하고 토큰을 저장하지 않는다', async () => {
    server.use(
      http.post(`${BASE}/auth/sign-in`, () =>
        HttpResponse.json(
          {
            code: ErrorCode.INVALID_CREDENTIALS,
            message: '이메일 또는 비밀번호가 올바르지 않습니다.',
          },
          { status: 401 },
        ),
      ),
    );
    const store = new InMemoryTokenStore(null);

    const result = await signInAction(CREDENTIALS, { baseUrl: BASE, store });

    expect(result).toEqual({
      ok: false,
      code: ErrorCode.INVALID_CREDENTIALS,
      message: '이메일 또는 비밀번호가 올바르지 않습니다.',
    });
    expect(await store.read()).toBeNull();
  });

  it('응답이 계약 형태가 아니면 내부 오류로 처리한다', async () => {
    // BFF가 계산하지 않는다는 규칙(§8.1)은 "형태를 확인하지 않는다"와 다르다.
    server.use(
      http.post(`${BASE}/auth/sign-in`, () => HttpResponse.json({ hi: 1 }, { status: 200 })),
    );
    const store = new InMemoryTokenStore(null);

    const result = await signInAction(CREDENTIALS, { baseUrl: BASE, store });

    expect(result).toEqual({
      ok: false,
      code: ErrorCode.INTERNAL_ERROR,
      message: expect.any(String),
    });
    expect(await store.read()).toBeNull();
  });
});

describe('signOutAction', () => {
  it('Nest에 알리고 쿠키를 비운다', async () => {
    let seenBody: unknown = null;
    server.use(
      http.post(`${BASE}/auth/sign-out`, async ({ request }) => {
        seenBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const store = new InMemoryTokenStore({ accessToken: 'a', refreshToken: 'r' });

    expect(await signOutAction({ baseUrl: BASE, store })).toEqual({ ok: true });
    expect(seenBody).toEqual({ refreshToken: 'r' });
    expect(await store.read()).toBeNull();
  });

  it('세션이 없어도 성공한다', async () => {
    const store = new InMemoryTokenStore(null);
    expect(await signOutAction({ baseUrl: BASE, store })).toEqual({ ok: true });
  });

  it('Nest가 실패해도 쿠키는 비운다', async () => {
    // 서버가 죽었는데 브라우저에 세션이 남아 있으면 사용자는 로그아웃했다고 믿는다.
    // 로컬 세션을 지우는 것은 항상 성공해야 한다.
    server.use(http.post(`${BASE}/auth/sign-out`, () => HttpResponse.error()));
    const store = new InMemoryTokenStore({ accessToken: 'a', refreshToken: 'r' });

    expect(await signOutAction({ baseUrl: BASE, store })).toEqual({ ok: true });
    expect(await store.read()).toBeNull();
  });
});
