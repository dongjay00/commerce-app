import { ErrorCode } from '@commerce/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { anAddressDto } from '@/shared/api/msw/fixtures';
import { server } from '@/shared/api/msw/server';
import { MESSAGES } from '@/shared/lib/api-error';
import { useAddAddress } from './use-add-address';

const INPUT = {
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
};

describe('useAddAddress', () => {
  it('처음에는 대기 중도 아니고 에러도 없다', () => {
    const { result } = renderHook(() => useAddAddress());

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('성공하면 생성된 AddressDto를 돌려준다', async () => {
    const address = anAddressDto();
    server.use(http.post('/api/addresses', () => HttpResponse.json(address, { status: 200 })));
    const { result } = renderHook(() => useAddAddress());

    let created: unknown;
    await act(async () => {
      created = await result.current.addAddress(INPUT);
    });

    expect(created).toEqual(address);
    expect(result.current.error).toBeNull();
  });

  it('요청 중에는 pending이 켜지고 끝나면 꺼진다', async () => {
    const { result } = renderHook(() => useAddAddress());

    let resolveRequest: (() => void) | undefined;
    server.use(
      http.post('/api/addresses', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve;
        });
        return HttpResponse.json(anAddressDto(), { status: 200 });
      }),
    );

    let promise: Promise<unknown> | undefined;
    act(() => {
      promise = result.current.addAddress(INPUT);
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    await act(async () => {
      resolveRequest?.();
      await promise;
    });

    expect(result.current.pending).toBe(false);
  });

  it('실패하면 null을 돌려주고 코드에 맞는 문구를 담는다', async () => {
    server.use(
      http.post('/api/addresses', () =>
        HttpResponse.json({ code: ErrorCode.VALIDATION_FAILED, message: 'x' }, { status: 400 }),
      ),
    );
    const { result } = renderHook(() => useAddAddress());

    let created: unknown;
    await act(async () => {
      created = await result.current.addAddress(INPUT);
    });

    expect(created).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.VALIDATION_FAILED]);
    expect(result.current.pending).toBe(false);
  });

  it('다시 시도하면 이전 에러가 지워진다', async () => {
    server.use(
      http.post('/api/addresses', () =>
        HttpResponse.json({ code: ErrorCode.VALIDATION_FAILED, message: 'x' }, { status: 400 }),
      ),
    );
    const { result } = renderHook(() => useAddAddress());
    await act(async () => {
      await result.current.addAddress(INPUT);
    });
    expect(result.current.error).not.toBeNull();

    server.resetHandlers();
    await act(async () => {
      await result.current.addAddress(INPUT);
    });

    expect(result.current.error).toBeNull();
  });

  it('네트워크가 끊겨도 던지지 않는다', async () => {
    server.use(http.post('/api/addresses', () => HttpResponse.error()));
    const { result } = renderHook(() => useAddAddress());

    let created: unknown;
    await act(async () => {
      created = await result.current.addAddress(INPUT);
    });

    expect(created).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
  });

  it('응답이 계약 형태가 아니면 null이고 INTERNAL_ERROR 문구다', async () => {
    // 태스크 5의 placeOrderAction과 같은 이유: 성공 상태 코드인데 본문이
    // AddressDto 계약을 벗어나면 훅이 그대로 넘기지 않고 안전하게 실패한다.
    server.use(
      http.post('/api/addresses', () => HttpResponse.json({ not: 'an-address' }, { status: 200 })),
    );
    const { result } = renderHook(() => useAddAddress());

    let created: unknown;
    await act(async () => {
      created = await result.current.addAddress(INPUT);
    });

    expect(created).toBeNull();
    expect(result.current.error).toBe(MESSAGES[ErrorCode.INTERNAL_ERROR]);
  });
});
