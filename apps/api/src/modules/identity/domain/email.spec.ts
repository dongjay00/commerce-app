import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { Email, InvalidEmailError } from './email';

// vitest 3.2.7의 toThrow 타입(Constructable = new (...args: any[]) => any)은 concrete
// 생성자만 받는다. DomainError는 abstract라 그대로 넘기면 tsc가 거부한다(identifiers.spec.ts
// 참고). 런타임 동작은 abstract 여부와 무관하므로 타입 단계에서만 unknown을 거쳐 우회한다.
const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;

describe('Email', () => {
  it('정상 이메일을 만든다', () => {
    expect(Email.of('user@example.com').value).toBe('user@example.com');
  });

  it('대소문자를 소문자로 정규화한다', () => {
    // 정규화가 유일성의 근거다. 정규화하지 않으면 User@x.com과 user@x.com이
    // 서로 다른 계정이 되고, DB의 unique 인덱스도 둘을 막지 못한다.
    expect(Email.of('User@Example.COM').value).toBe('user@example.com');
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(Email.of('  user@example.com  ').value).toBe('user@example.com');
  });

  it('정규화 결과가 같으면 equals가 참이다', () => {
    expect(Email.of('User@Example.com').equals(Email.of('user@example.com'))).toBe(true);
  });

  it.each([
    ['@ 없음', 'userexample.com'],
    ['로컬부 없음', '@example.com'],
    ['도메인 없음', 'user@'],
    ['점 없는 도메인', 'user@example'],
    ['공백 포함', 'us er@example.com'],
    ['@ 두 개', 'user@@example.com'],
    ['빈 문자열', ''],
    ['공백만', '   '],
  ])('%s이면 거부한다', (_label, raw) => {
    expect(() => Email.of(raw)).toThrow(InvalidEmailError);
  });

  it('254자를 넘으면 거부한다', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`;
    expect(() => Email.of(tooLong)).toThrow(InvalidEmailError);
  });

  it('실패는 DomainError다 — 사용자가 고칠 수 있는 입력이다', () => {
    expect(() => Email.of('nope')).toThrow(DomainErrorConstructor);
  });

  it('toString이 값을 그대로 준다', () => {
    expect(`${Email.of('user@example.com')}`).toBe('user@example.com');
  });
});
