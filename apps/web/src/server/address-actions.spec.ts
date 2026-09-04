import { ErrorCode } from '@commerce/contracts';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { anAddressDto } from '../shared/api/msw/fixtures';
import { server } from '../shared/api/msw/server';
import { addAddressAction } from './address-actions';
import { SessionExpiredError } from './api-client';
import { InMemoryTokenStore } from './testing/in-memory-token-store';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

const deps = (
  tokens: { accessToken: string; refreshToken: string } | null = {
    accessToken: 'a',
    refreshToken: 'r',
  },
) => ({ baseUrl: BASE, store: new InMemoryTokenStore(tokens) });

const validBody = {
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
};

describe('addAddressAction', () => {
  it('생성에 성공하면 AddressDto를 data에 담는다', async () => {
    const result = await addAddressAction(validBody, deps());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(anAddressDto());
    }
  });

  it('입력이 잘못되면 VALIDATION_FAILED로 분기할 수 있다', async () => {
    server.use(
      http.post(`${BASE}/addresses`, () =>
        HttpResponse.json(
          { code: ErrorCode.VALIDATION_FAILED, message: '입력값 오류' },
          { status: 400 },
        ),
      ),
    );

    const result = await addAddressAction(validBody, deps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it('세션이 없으면 SessionExpiredError다', async () => {
    await expect(addAddressAction(validBody, deps(null))).rejects.toThrow(SessionExpiredError);
  });

  it('성공 응답인데 본문이 계약과 다르면 던지지 않고 INTERNAL_ERROR로 분기한다', async () => {
    // `readActionResult`는 성공 경로에서 본문이 JSON이 아니면 `parse`에 `null`을
    // 그대로 넘긴다(가드 없음). `safeParse`로 감싸지 않았다면 이 케이스가 잡히지
    // 않는 `ZodError`로 터진다.
    server.use(
      http.post(
        `${BASE}/addresses`,
        () => new HttpResponse('<html>not json</html>', { status: 201 }),
      ),
    );

    const result = await addAddressAction(validBody, deps());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ErrorCode.INTERNAL_ERROR);
    }
  });
});
