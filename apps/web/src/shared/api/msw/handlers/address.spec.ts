import { addressContract } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';

const BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';

describe('address MSW 핸들러', () => {
  it('목록 응답이 계약 스키마를 만족한다', async () => {
    const body = await (await fetch(`${BASE}/addresses`)).json();
    expect(() => addressContract.list.responses[200].parse(body)).not.toThrow();
  });

  it('추가 요청이 계약을 만족하면 201이다', async () => {
    const response = await fetch(`${BASE}/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: '회사',
        recipient: '홍길동',
        phone: '010-1234-5678',
        zip: '06236',
        line1: '서울시 강남구 테헤란로 1',
      }),
    });
    expect(response.status).toBe(201);
  });

  it('계약을 벗어난 추가 요청은 핸들러가 던진다', async () => {
    const response = await fetch(`${BASE}/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: '',
        recipient: '홍길동',
        phone: '010-1234-5678',
        zip: '06236',
        line1: '서울시 강남구 테헤란로 1',
      }),
    });
    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
