import { ErrorCode } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { MESSAGES, readActionResult } from './api-error';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('readActionResult', () => {
  it('204면 ok: true이고 data는 undefined다', async () => {
    const result = await readActionResult(new Response(null, { status: 204 }));
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('200이고 parse가 있으면 파싱한 값을 담는다', async () => {
    const result = await readActionResult(
      jsonResponse(200, { id: 'x' }),
      (body) => body as { id: string },
    );
    expect(result).toEqual({ ok: true, data: { id: 'x' } });
  });

  it('에러 응답의 code로 분기할 수 있다', async () => {
    // 스펙 §8.6: 프론트는 상태 코드가 아니라 코드로 분기한다.
    const result = await readActionResult(
      jsonResponse(409, { code: ErrorCode.INSUFFICIENT_STOCK, message: '재고가 부족합니다: x' }),
    );
    expect(result).toEqual({
      ok: false,
      code: ErrorCode.INSUFFICIENT_STOCK,
      message: MESSAGES[ErrorCode.INSUFFICIENT_STOCK],
    });
  });

  it('서버 메시지가 아니라 우리 문구를 쓴다', async () => {
    // 서버 메시지에는 SKU id 같은 내부 식별자가 들어 있다 — 사용자에게 보일 것이 아니다.
    const result = await readActionResult(
      jsonResponse(409, {
        code: ErrorCode.INSUFFICIENT_STOCK,
        message: '재고가 부족합니다: 018f...',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain('018f');
    }
  });

  it('알 수 없는 코드는 INTERNAL_ERROR로 떨어진다', async () => {
    const result = await readActionResult(jsonResponse(500, { code: 'WEIRD', message: 'x' }));
    expect(result).toEqual({
      ok: false,
      code: ErrorCode.INTERNAL_ERROR,
      message: MESSAGES[ErrorCode.INTERNAL_ERROR],
    });
  });

  it('본문이 JSON이 아니어도 던지지 않는다', async () => {
    // 프록시의 HTML 502 같은 경우다. 여기서 던지면 화면이 통째로 죽는다.
    const result = await readActionResult(new Response('<html>502</html>', { status: 502 }));
    expect(result).toEqual({
      ok: false,
      code: ErrorCode.INTERNAL_ERROR,
      message: MESSAGES[ErrorCode.INTERNAL_ERROR],
    });
  });

  it('모든 ErrorCode에 문구가 있다', async () => {
    // 하나라도 빠지면 그 에러가 화면에 `undefined`로 나간다.
    for (const code of Object.values(ErrorCode)) {
      expect(MESSAGES[code], code).toBeTruthy();
    }
  });
});
