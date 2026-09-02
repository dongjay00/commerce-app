import { describe, expect, it } from 'vitest';
import { requireSessionPassword, sessionOptions } from './session';

describe('requireSessionPassword', () => {
  it('SESSION_PASSWORD가 없으면 던진다', () => {
    expect(() => requireSessionPassword({})).toThrow(/SESSION_PASSWORD/);
  });

  it('SESSION_PASSWORD가 32자 미만이면 던진다', () => {
    expect(() => requireSessionPassword({ SESSION_PASSWORD: 'too-short' })).toThrow(
      /SESSION_PASSWORD/,
    );
  });

  it('SESSION_PASSWORD가 32자 이상이면 그대로 돌려준다', () => {
    const password = 'a'.repeat(32);
    expect(requireSessionPassword({ SESSION_PASSWORD: password })).toBe(password);
  });
});

const PASSWORD = 'a'.repeat(32);

describe('sessionOptions', () => {
  // I5: 이 세 플래그가 스펙 §8.5("브라우저 자바스크립트는 토큰을 볼 수 없다")가
  // 성립하는 이유 전부다. httpOnly가 false로 바뀌어도 이 저장소의 다른 어떤 검사도
  // 이를 잡지 못한다 — cookieTokenStore는 cookies()가 필요해 목 없이 테스트할 수
  // 없고, sessionOptions는 process.env의 순수 함수라 목 없이도 직접 검증할 수 있다.
  it('httpOnly와 sameSite=lax를 켠다', () => {
    const options = sessionOptions({ SESSION_PASSWORD: PASSWORD, NODE_ENV: 'development' });

    expect(options.cookieOptions?.httpOnly).toBe(true);
    expect(options.cookieOptions?.sameSite).toBe('lax');
  });

  it('개발 환경에서는 secure를 켜지 않는다', () => {
    const options = sessionOptions({ SESSION_PASSWORD: PASSWORD, NODE_ENV: 'development' });

    expect(options.cookieOptions?.secure).toBe(false);
  });

  it('production 환경에서는 secure를 켠다', () => {
    const options = sessionOptions({ SESSION_PASSWORD: PASSWORD, NODE_ENV: 'production' });

    expect(options.cookieOptions?.secure).toBe(true);
  });
});
