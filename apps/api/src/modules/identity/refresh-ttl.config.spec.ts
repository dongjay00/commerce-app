import { describe, expect, it } from 'vitest';
import { Duration } from '../../shared/kernel/duration';
import { readRefreshTtl } from './refresh-ttl.config';

describe('readRefreshTtl', () => {
  it('환경변수를 읽는다', () => {
    expect(readRefreshTtl({ REFRESH_TOKEN_TTL_DAYS: '7' }).millis).toBe(
      Duration.hours(24 * 7).millis,
    );
  });

  it('없으면 14일을 쓴다', () => {
    expect(readRefreshTtl({}).millis).toBe(Duration.hours(24 * 14).millis);
  });

  it('숫자가 아니면 부팅을 거부한다', () => {
    expect(() => readRefreshTtl({ REFRESH_TOKEN_TTL_DAYS: 'abc' })).toThrow(
      /REFRESH_TOKEN_TTL_DAYS/,
    );
  });

  it('0 이하면 거부한다', () => {
    expect(() => readRefreshTtl({ REFRESH_TOKEN_TTL_DAYS: '0' })).toThrow(/REFRESH_TOKEN_TTL_DAYS/);
  });

  it('정수가 아니면 거부한다', () => {
    expect(() => readRefreshTtl({ REFRESH_TOKEN_TTL_DAYS: '1.5' })).toThrow(
      /REFRESH_TOKEN_TTL_DAYS/,
    );
  });
});
