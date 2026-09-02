import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { EmailAlreadyRegisteredError, InvalidCredentialsError } from './account.errors';

// vitest 3.2.7의 toThrow 타입(Constructable = new (...args: any[]) => any)은 concrete
// 생성자만 받는다. DomainError는 abstract라 그대로 넘기면 tsc가 거부한다(identifiers.spec.ts
// 참고). 런타임 동작은 abstract 여부와 무관하므로 타입 단계에서만 unknown을 거쳐 우회한다.
const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;

describe('EmailAlreadyRegisteredError', () => {
  it('CODE가 EMAIL_ALREADY_REGISTERED다', () => {
    // 이 CODE가 DomainErrorRegistry가 HTTP 상태로 매핑하는 키다. 오타가 나도 던지지
    // 않고 {422, DOMAIN_RULE_VIOLATED}로 조용히 새어 들어간다 — 여기서 못박는다.
    expect(EmailAlreadyRegisteredError.CODE).toBe('EMAIL_ALREADY_REGISTERED');
    const err = new EmailAlreadyRegisteredError('user@example.com');
    expect(err.code).toBe(EmailAlreadyRegisteredError.CODE);
  });

  it('DomainError다 — 사용자가 고칠 수 있는 조건이다', () => {
    expect(() => {
      throw new EmailAlreadyRegisteredError('user@example.com');
    }).toThrow(DomainErrorConstructor);
    expect(new EmailAlreadyRegisteredError('user@example.com')).toBeInstanceOf(DomainError);
  });

  it('메시지에 이메일을 포함한다', () => {
    const err = new EmailAlreadyRegisteredError('user@example.com');
    expect(err.message).toContain('user@example.com');
  });
});

describe('InvalidCredentialsError', () => {
  it('CODE가 INVALID_CREDENTIALS다', () => {
    expect(InvalidCredentialsError.CODE).toBe('INVALID_CREDENTIALS');
    const err = new InvalidCredentialsError();
    expect(err.code).toBe(InvalidCredentialsError.CODE);
  });

  it('DomainError다 — 사용자가 고칠 수 있는 조건이다', () => {
    expect(() => {
      throw new InvalidCredentialsError();
    }).toThrow(DomainErrorConstructor);
    expect(new InvalidCredentialsError()).toBeInstanceOf(DomainError);
  });

  it('인자를 받지 않고, 이메일 존재 여부나 어느 쪽이 틀렸는지 메시지에 담지 않는다', () => {
    // 구분해서 담으면 "이 이메일은 가입돼 있다"는 사실이 새어 계정 열거 공격의
    // 재료가 된다. 그래서 생성자가 인자를 아예 받지 않는다.
    expect(InvalidCredentialsError).toHaveLength(0);
    const err = new InvalidCredentialsError();
    expect(err.message).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
  });

  it('두 CODE는 서로 다르다', () => {
    expect(EmailAlreadyRegisteredError.CODE).not.toBe(InvalidCredentialsError.CODE);
  });
});
