import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { Credential, InvalidCredentialError } from './credential';

// vitest 3.2.7의 toThrow 타입(Constructable = new (...args: any[]) => any)은 concrete
// 생성자만 받는다. DomainError는 abstract라 그대로 넘기면 tsc가 거부한다(identifiers.spec.ts
// 참고). 런타임 동작은 abstract 여부와 무관하므로 타입 단계에서만 unknown을 거쳐 우회한다.
const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$hashvalue';

describe('Credential', () => {
  it('해시 문자열로 만든다', () => {
    expect(Credential.fromHash(HASH).hash).toBe(HASH);
  });

  it('빈 해시를 거부한다', () => {
    expect(() => Credential.fromHash('')).toThrow(InvalidCredentialError);
  });

  it('공백뿐인 해시를 거부한다', () => {
    expect(() => Credential.fromHash('   ')).toThrow(InvalidCredentialError);
  });

  it('실패는 DomainError가 아니다 — 사용자 입력이 아니라 해셔/매퍼의 버그다', () => {
    // 빈 해시가 여기 도달했다면 해셔가 빈 문자열을 돌려줬거나 매퍼가 NULL 컬럼을
    // 읽은 것이다. 둘 다 사용자가 고칠 수 없으므로 500이 정직하다.
    expect(() => Credential.fromHash('')).not.toThrow(DomainErrorConstructor);
  });

  it('같은 해시면 equals가 참이다', () => {
    expect(Credential.fromHash(HASH).equals(Credential.fromHash(HASH))).toBe(true);
  });

  it('다른 해시면 equals가 거짓이다', () => {
    expect(Credential.fromHash(HASH).equals(Credential.fromHash(`${HASH}x`))).toBe(false);
  });
});
