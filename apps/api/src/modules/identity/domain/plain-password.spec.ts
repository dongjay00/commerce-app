import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { PasswordPolicyViolationError, PlainPassword } from './plain-password';

// vitest 3.2.7의 toThrow 타입(Constructable = new (...args: any[]) => any)은 concrete
// 생성자만 받는다. DomainError는 abstract라 그대로 넘기면 tsc가 거부한다(identifiers.spec.ts
// 참고). 런타임 동작은 abstract 여부와 무관하므로 타입 단계에서만 unknown을 거쳐 우회한다.
const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;

const SECRET = 'correct horse battery staple';

describe('PlainPassword', () => {
  it('정책을 만족하는 비밀번호를 만든다', () => {
    expect(PlainPassword.of(SECRET).reveal()).toBe(SECRET);
  });

  it('10자 미만을 거부한다', () => {
    expect(() => PlainPassword.of('123456789')).toThrow(PasswordPolicyViolationError);
  });

  it('정확히 10자는 통과한다', () => {
    expect(() => PlainPassword.of('1234567890')).not.toThrow();
  });

  it('128자를 넘으면 거부한다', () => {
    // 상한이 없으면 임의 길이 입력이 Argon2에 그대로 들어가 해싱 비용이 입력에 비례한다.
    expect(() => PlainPassword.of('x'.repeat(129))).toThrow(PasswordPolicyViolationError);
  });

  it('정확히 128자는 통과한다', () => {
    expect(() => PlainPassword.of('x'.repeat(128))).not.toThrow();
  });

  it('공백을 제거하지 않는다 — 공백도 비밀번호의 일부다', () => {
    const withSpaces = '  spaced out password  ';
    expect(PlainPassword.of(withSpaces).reveal()).toBe(withSpaces);
  });

  it('정책 위반은 DomainError다', () => {
    expect(() => PlainPassword.of('short')).toThrow(DomainErrorConstructor);
  });

  it('문자열로 변환해도 비밀번호가 드러나지 않는다', () => {
    // 실수로 로그에 찍히는 경로를 하나라도 줄인다.
    expect(`${PlainPassword.of(SECRET)}`).not.toContain('horse');
    expect(`${PlainPassword.of(SECRET)}`).toBe('[PlainPassword]');
  });

  it('JSON으로 직렬화해도 비밀번호가 드러나지 않는다', () => {
    const serialized = JSON.stringify({ password: PlainPassword.of(SECRET) });
    expect(serialized).not.toContain('horse');
  });
});
