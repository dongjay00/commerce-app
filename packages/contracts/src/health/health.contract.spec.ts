import { describe, expect, it } from 'vitest';
import { healthContract } from './health.contract';

describe('healthContract', () => {
  it('GET /health 경로를 노출한다', () => {
    expect(healthContract.check.method).toBe('GET');
    expect(healthContract.check.path).toBe('/health');
  });

  it('정상 응답을 통과시킨다', () => {
    const parsed = healthContract.check.responses[200].parse({
      status: 'ok',
      database: 'up',
    });
    expect(parsed.database).toBe('up');
  });

  it('database가 down인 응답도 유효하다', () => {
    expect(() =>
      healthContract.check.responses[200].parse({ status: 'ok', database: 'down' }),
    ).not.toThrow();
  });

  it('알 수 없는 database 값을 거부한다', () => {
    expect(() =>
      healthContract.check.responses[200].parse({ status: 'ok', database: 'maybe' }),
    ).toThrow();
  });

  it('계약에 없는 필드를 거부한다', () => {
    expect(() =>
      healthContract.check.responses[200].parse({ status: 'ok', database: 'up', uptime: 123 }),
    ).toThrow();
  });
});
