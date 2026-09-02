import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 이메일 형식이 아닐 때. 형식 검증은 원칙적으로 어댑터의 Zod가 하지만(스펙 §8.4),
 * 정규화(trim + 소문자)가 도메인의 책임이라 검증도 여기 한 벌 더 있다.
 * 정규화 없이는 `User@x.com`과 `user@x.com`이 서로 다른 계정이 되고, DB의 unique
 * 인덱스도 그 둘을 막지 못한다 — 즉 이건 형식이 아니라 **유일성 불변식**의 일부다.
 *
 * `Email.of` 전용이다 — 인바운드 값이 형식을 어겼을 때만 던진다(400).
 */
export class InvalidEmailError extends DomainError {
  static readonly CODE = 'INVALID_EMAIL';
  readonly code = InvalidEmailError.CODE;

  constructor(raw: string) {
    super(`이메일 형식이 아닙니다: "${raw}"`);
  }
}

/**
 * 데이터베이스에서 읽어온 `accounts.email`이 이메일 형식이 아닐 때 던진다.
 *
 * `InvalidEmailError`와 갈라놓은 이유는 `identifiers.ts`의 `CorruptedRecordError`와
 * 같다 — 두 경로가 같은 예외를 던지면 **저장된 행이 깨진 상황에 400을 응답한다.**
 * 클라이언트의 요청은 멀쩡했고 우리 데이터가 깨진 것이므로 `DomainError`로 만들지
 * 않고 500으로 떨어뜨린다. `Email.fromPersistence` 전용이다.
 */
export class CorruptedEmailError extends Error {
  constructor(raw: string) {
    super(`저장된 이메일 값이 형식이 아닙니다: "${raw}"`);
    this.name = 'CorruptedEmailError';
    Error.captureStackTrace?.(this, CorruptedEmailError);
  }
}

// RFC 5322를 완전히 구현하지 않는다. 목적은 "명백히 이메일이 아닌 값"을 걸러 정규화의
// 전제를 지키는 것이고, 진짜 검증은 발송 가능 여부(확인 메일)로만 가능하다.
// 공백 없음 / @ 하나 / 도메인에 점 하나 이상 — 이 셋만 본다.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_LENGTH = 254; // RFC 5321의 경로 상한

function normalize(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  return normalized.length > MAX_LENGTH || !EMAIL_PATTERN.test(normalized) ? null : normalized;
}

export class Email {
  private constructor(readonly value: string) {}

  /** 인바운드 전용. 실패는 사용자 입력 오류(400). */
  static of(raw: string): Email {
    const normalized = normalize(raw);
    if (normalized === null) {
      throw new InvalidEmailError(raw);
    }
    return new Email(normalized);
  }

  /** 영속 복원 전용. 실패는 데이터 무결성 결함(500). */
  static fromPersistence(raw: string): Email {
    const normalized = normalize(raw);
    if (normalized === null) {
      throw new CorruptedEmailError(raw);
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
