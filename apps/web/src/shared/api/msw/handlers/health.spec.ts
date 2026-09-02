import { healthContract } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';

describe('health MSW 핸들러', () => {
  it('가로챈 응답이 계약 스키마를 만족한다', async () => {
    const response = await fetch('http://api.test/health');
    const body = await response.json();

    expect(() => healthContract.check.responses[200].parse(body)).not.toThrow();
  });

  it('응답 내용이 핸들러가 선언한 값과 같다', async () => {
    const response = await fetch('http://api.test/health');

    await expect(response.json()).resolves.toEqual({ status: 'ok', database: 'up' });
  });
});
