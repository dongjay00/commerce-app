import { ErrorCode } from '@commerce/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/shared/api/msw/server';
import { MESSAGES } from '@/shared/lib/api-error';
import { useSignIn } from './use-sign-in';

const CREDENTIALS = { email: 'a@example.com', password: 'correct horse battery staple' };

describe('useSignIn', () => {
  it('처음에는 대기 중도 아니고 에러도 없다', () => {
    const { result } = renderHook(() => useSignIn());

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('성공하면 true를 돌려준다', async () => {
    const { result } = renderHook(() => useSignIn());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.signIn(CREDENTIALS);
    });

    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('요청 중에는 pending이 켜지고 끝나면 꺼진다', async () => {
    // 버튼을 두 번 누르는 것을 막는 값이다. 안 꺼지면 화면이 영영 잠긴다.
    const { result } = renderHook(() => useSignIn());

    let resolveRequest: (() => void) | undefined;
    server.use(
      http.post('/api/auth/sign-in', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    let promise: Promise<boolean> | undefined;
    act(() => {
      promise = result.current.signIn(CREDENTIALS);
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      resolveRequest?.();
      await promise;
    });

    expect(result.current.pending).toBe(false);
  });

  it('실패하면 false를 돌려주고 코드에 맞는 문구를 담는다', async () => {
    // 스펙 §8.6: 상태 코드가 아니라 code로 분기한다.
    server.use(
      http.post('/api/auth/sign-in', () =>
        HttpResponse.json(
          { code: ErrorCode.INVALID_CREDENTIALS, message: '자격 증명이 올바르지 않습니다.' },
          { status: 401 },
        ),
      ),
    );
    const { result } = renderHook(() => useSignIn());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.signIn(CREDENTIALS);
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INVALID_CREDENTIALS]);
    expect(result.current.pending).toBe(false);
  });

  it('다시 시도하면 이전 에러가 지워진다', async () => {
    // 지우지 않으면 성공한 뒤에도 빨간 문구가 남는다.
    server.use(
      http.post('/api/auth/sign-in', () =>
        HttpResponse.json({ code: ErrorCode.INVALID_CREDENTIALS, message: 'x' }, { status: 401 }),
      ),
    );
    const { result } = renderHook(() => useSignIn());
    await act(async () => {
      await result.current.signIn(CREDENTIALS);
    });
    expect(result.current.error).not.toBeNull();

    server.resetHandlers();
    await act(async () => {
      await result.current.signIn(CREDENTIALS);
    });

    expect(result.current.error).toBeNull();
  });

  it('네트워크가 끊겨도 던지지 않는다', async () => {
    // 훅이 던지면 React 트리가 통째로 죽는다.
    server.use(http.post('/api/auth/sign-in', () => HttpResponse.error()));
    const { result } = renderHook(() => useSignIn());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.signIn(CREDENTIALS);
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
  });
});
