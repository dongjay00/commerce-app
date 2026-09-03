import { orderContract } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { ADDRESS_ID, ORDER_ID } from '../fixtures';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

describe('order MSW 핸들러', () => {
  it('상세 응답이 계약 스키마를 만족한다', async () => {
    const body = await (await fetch(`${BASE}/orders/${ORDER_ID}`)).json();
    expect(() => orderContract.get.responses[200].parse(body)).not.toThrow();
  });

  it('주문 요청이 계약을 만족하면 201이다', async () => {
    const response = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addressId: ADDRESS_ID }),
    });
    expect(response.status).toBe(201);
  });

  it('계약을 벗어난 주문 요청은 핸들러가 던진다', async () => {
    const response = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addressId: 'not-a-uuid' }),
    });
    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
