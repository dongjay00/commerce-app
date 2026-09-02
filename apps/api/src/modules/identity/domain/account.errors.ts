import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 이미 가입된 이메일. 유스케이스의 사전 조회와 **DB의 unique 인덱스** 두 곳에서 던진다.
 * 사전 조회만으로는 막을 수 없다 — 두 요청이 동시에 조회를 통과한 뒤 둘 다 INSERT를
 * 시도하는 창이 존재한다. 어댑터가 unique 위반(P2002)을 이 예외로 번역해야 한다.
 */
export class EmailAlreadyRegisteredError extends DomainError {
  static readonly CODE = 'EMAIL_ALREADY_REGISTERED';
  readonly code = EmailAlreadyRegisteredError.CODE;

  constructor(email: string) {
    super(`이미 가입된 이메일입니다: ${email}`);
  }
}

/**
 * 이메일이 없거나 비밀번호가 틀렸다. **두 경우를 구분하지 않는다** — 구분하면
 * "이 이메일은 가입돼 있다"는 사실이 새어 계정 열거 공격의 재료가 된다.
 * 메시지도 하나만 쓴다.
 */
export class InvalidCredentialsError extends DomainError {
  static readonly CODE = 'INVALID_CREDENTIALS';
  readonly code = InvalidCredentialsError.CODE;

  constructor() {
    super('이메일 또는 비밀번호가 올바르지 않습니다.');
  }
}
