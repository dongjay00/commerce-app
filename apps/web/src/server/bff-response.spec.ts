import { ErrorCode } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { SessionExpiredError } from './api-client';
import { handleBff, toResponse } from './bff-response';

describe('toResponse', () => {
  it('ok: true이고 data가 undefined면 204를 반환한다', () => {
    const response = toResponse({ ok: true, data: undefined });

    expect(response.status).toBe(204);
  });

  it('ok: true이고 data가 있으면 200과 본문을 반환한다', async () => {
    const response = toResponse({ ok: true, data: { id: '1' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '1' });
  });

  it.each([
    [ErrorCode.VALIDATION_FAILED, 400],
    [ErrorCode.UNAUTHENTICATED, 401],
    [ErrorCode.INVALID_CREDENTIALS, 401],
    [ErrorCode.FORBIDDEN, 403],
    [ErrorCode.NOT_FOUND, 404],
    [ErrorCode.INSUFFICIENT_STOCK, 409],
    [ErrorCode.ORDER_NOT_CANCELLABLE, 409],
    [ErrorCode.EMAIL_ALREADY_REGISTERED, 409],
    [ErrorCode.DOMAIN_RULE_VIOLATED, 422],
    [ErrorCode.QUANTITY_BELOW_MINIMUM, 422],
    [ErrorCode.PASSWORD_POLICY_VIOLATED, 422],
    [ErrorCode.PAYMENT_DECLINED, 422],
  ])('%s는 %i로 나간다', async (code, status) => {
    const response = toResponse({ ok: false, code, message: 'x' });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, message: 'x' });
  });

  it('매핑에 없는 코드는 500으로 나간다', async () => {
    const response = toResponse({ ok: false, code: ErrorCode.INTERNAL_ERROR, message: 'x' });

    expect(response.status).toBe(500);
  });
});

describe('handleBff', () => {
  it('SessionExpiredError를 401로 바꾼다', async () => {
    const response = await handleBff(async () => {
      throw new SessionExpiredError('세션이 없습니다.');
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: ErrorCode.UNAUTHENTICATED,
      message: '로그인이 필요합니다.',
    });
  });

  it('다른 예외는 그대로 던진다', async () => {
    await expect(
      handleBff(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('성공하면 work의 응답을 그대로 돌려준다', async () => {
    const response = await handleBff(async () => new Response(null, { status: 204 }));

    expect(response.status).toBe(204);
  });
});
