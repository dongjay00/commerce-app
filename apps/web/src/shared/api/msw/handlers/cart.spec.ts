import { cartContract } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { SKU_ID } from '../fixtures';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

describe('cart MSW 핸들러', () => {
  it('조회 응답이 계약 스키마를 만족한다', async () => {
    const body = await (await fetch(`${BASE}/cart`)).json();
    expect(() => cartContract.get.responses[200].parse(body)).not.toThrow();
  });

  it('담기 요청이 계약을 만족하면 204다', async () => {
    const response = await fetch(`${BASE}/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skuId: SKU_ID, quantity: 2 }),
    });
    expect(response.status).toBe(204);
  });

  it('계약을 벗어난 담기 요청은 핸들러가 던진다', async () => {
    // MSW의 onUnhandledRequest는 'error'지만 핸들러 안의 예외는 500으로 나온다.
    // 이 단언이 "요청 검증이 실제로 돈다"를 증명한다 — 없으면 handlers가 본문을
    // 무시해도 아무도 모른다.
    const response = await fetch(`${BASE}/cart/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skuId: 'not-a-uuid', quantity: 0 }),
    });
    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
