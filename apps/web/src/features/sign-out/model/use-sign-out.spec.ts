import { ErrorCode } from '@commerce/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/shared/api/msw/server';
import { useSignOut } from './use-sign-out';

describe('useSignOut', () => {
  it('처음에는 대기 중이 아니다', () => {
    const { result } = renderHook(() => useSignOut());

    expect(result.current.pending).toBe(false);
  });

  it('성공하면 true를 돌려준다', async () => {
    const { result } = renderHook(() => useSignOut());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.signOut();
    });

    expect(ok).toBe(true);
  });

  it('요청 중에는 pending이 켜지고 끝나면 꺼진다', async () => {
    // 버튼을 두 번 누르는 것을 막는 값이다. 안 꺼지면 화면이 영영 잠긴다.
    const { result } = renderHook(() => useSignOut());

    let resolveRequest: (() => void) | undefined;
    server.use(
      http.post('/api/auth/sign-out', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    let promise: Promise<boolean> | undefined;
    act(() => {
      promise = result.current.signOut();
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      resolveRequest?.();
      await promise;
    });

    expect(result.current.pending).toBe(false);
  });

  it('실패하면 던지지 않고 false를 돌려준다', async () => {
    // 스펙 §8.6: 상태 코드가 아니라 code로 분기한다.
    server.use(
      http.post('/api/auth/sign-out', () =>
        HttpResponse.json({ code: ErrorCode.UNAUTHENTICATED, message: 'x' }, { status: 401 }),
      ),
    );
    const { result } = renderHook(() => useSignOut());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.signOut();
    });

    expect(ok).toBe(false);
    expect(result.current.pending).toBe(false);
  });

  it('네트워크가 끊겨도 던지지 않는다', async () => {
    // 훅이 던지면 React 트리가 통째로 죽는다.
    server.use(http.post('/api/auth/sign-out', () => HttpResponse.error()));
    const { result } = renderHook(() => useSignOut());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.signOut();
    });

    expect(ok).toBe(false);
    expect(result.current.pending).toBe(false);
  });
});
