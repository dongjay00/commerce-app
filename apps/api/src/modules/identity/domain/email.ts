import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 이메일 형식이 아닐 때. 형식 검증은 원칙적으로 어댑터의 Zod가 하지만(스펙 §8.4),
 * 정규화(trim + 소문자)가 도메인의 책임이라 검증도 여기 한 벌 더 있다.
 * 정규화 없이는 `User@x.com`과 `user@x.com`이 서로 다른 계정이 되고, DB의 unique
 * 인덱스도 그 둘을 막지 못한다 — 즉 이건 형식이 아니라 **유일성 불변식**의 일부다.
 */
export class InvalidEmailError extends DomainError {
  static readonly CODE = 'INVALID_EMAIL';
  readonly code = InvalidEmailError.CODE;

  constructor(raw: string) {
    super(`이메일 형식이 아닙니다: "${raw}"`);
  }
}

// RFC 5322를 완전히 구현하지 않는다. 목적은 "명백히 이메일이 아닌 값"을 걸러 정규화의
// 전제를 지키는 것이고, 진짜 검증은 발송 가능 여부(확인 메일)로만 가능하다.
// 공백 없음 / @ 하나 / 도메인에 점 하나 이상 — 이 셋만 본다.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_LENGTH = 254; // RFC 5321의 경로 상한

export class Email {
  private constructor(readonly value: string) {}

  static of(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length > MAX_LENGTH || !EMAIL_PATTERN.test(normalized)) {
      throw new InvalidEmailError(raw);
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
