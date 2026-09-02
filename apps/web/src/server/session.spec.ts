import { describe, expect, it } from 'vitest';
import { requireSessionPassword } from './session';

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
