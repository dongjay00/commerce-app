import { describe, expect, it } from 'vitest';
import { readJwtConfig } from './jwt.config';

const LONG_SECRET = 'x'.repeat(32);

describe('readJwtConfig', () => {
  it('환경변수를 읽는다', () => {
    const config = readJwtConfig({ JWT_SECRET: LONG_SECRET, ACCESS_TOKEN_TTL_SECONDS: '900' });
    expect(config.secret).toBe(LONG_SECRET);
    expect(config.accessTokenTtlSeconds).toBe(900);
  });

  it('TTL이 없으면 900초를 쓴다', () => {
    expect(readJwtConfig({ JWT_SECRET: LONG_SECRET }).accessTokenTtlSeconds).toBe(900);
  });

  it('JWT_SECRET이 없으면 부팅을 거부한다', () => {
    expect(() => readJwtConfig({})).toThrow(/JWT_SECRET/);
  });

  it('32자 미만인 비밀키는 거부한다', () => {
    // HS256의 안전성은 키 엔트로피에 달려 있다. 개발 편의로 넣은 짧은 키가 그대로
    // 운영에 나가는 것이 가장 흔한 경로라, 부팅 자체를 막는다.
    expect(() => readJwtConfig({ JWT_SECRET: 'short' })).toThrow(/32/);
  });

  it('TTL이 숫자가 아니면 거부한다', () => {
    expect(() =>
      readJwtConfig({ JWT_SECRET: LONG_SECRET, ACCESS_TOKEN_TTL_SECONDS: 'abc' }),
    ).toThrow(/ACCESS_TOKEN_TTL_SECONDS/);
  });

  it('TTL이 0 이하면 거부한다', () => {
    expect(() => readJwtConfig({ JWT_SECRET: LONG_SECRET, ACCESS_TOKEN_TTL_SECONDS: '0' })).toThrow(
      /ACCESS_TOKEN_TTL_SECONDS/,
    );
  });
});
