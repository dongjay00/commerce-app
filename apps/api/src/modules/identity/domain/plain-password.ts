import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 비밀번호 길이 정책 위반. **정책은 도메인의 것이지 Zod의 것이 아니다**(스펙 §8.4).
 * 계약의 Zod 스키마에 `.min(10)`을 붙이는 순간 같은 규칙이 두 곳에 생기고, 정책을
 * 바꿀 때 한쪽만 고쳐도 아무도 알려주지 않는다.
 */
export class PasswordPolicyViolationError extends DomainError {
  static readonly CODE = 'PASSWORD_POLICY_VIOLATED';
  readonly code = PasswordPolicyViolationError.CODE;

  constructor(reason: string) {
    super(`비밀번호 정책 위반: ${reason}`);
  }
}

const MIN_LENGTH = 10;
const MAX_LENGTH = 128;

/**
 * 평문 비밀번호 값 객체. 절대 저장되지 않고 해셔 어댑터까지만 간다.
 *
 * `#raw`를 private 클래스 필드로 두고 `toString`/`toJSON`을 덮어쓴 것은 실수로 로그나
 * 응답에 실리는 경로를 줄이기 위한 것이다. 완전한 방어는 아니다 — `util.inspect`나
 * 디버거는 여전히 값을 볼 수 있다. 이 객체를 통째로 로깅하지 않는 규율이 여전히 필요하다.
 */
export class PlainPassword {
  readonly #raw: string;

  private constructor(raw: string) {
    this.#raw = raw;
  }

  static of(raw: string): PlainPassword {
    if (raw.length < MIN_LENGTH) {
      throw new PasswordPolicyViolationError(`${MIN_LENGTH}자 이상이어야 합니다`);
    }
    if (raw.length > MAX_LENGTH) {
      throw new PasswordPolicyViolationError(`${MAX_LENGTH}자 이하여야 합니다`);
    }
    return new PlainPassword(raw);
  }

  /** 해셔 어댑터만 호출한다. 다른 곳에서 부르면 평문이 그 코드에 남는다. */
  reveal(): string {
    return this.#raw;
  }

  toString(): string {
    return '[PlainPassword]';
  }

  toJSON(): string {
    return '[PlainPassword]';
  }
}
