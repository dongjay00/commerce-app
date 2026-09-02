import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 만료된 세션을 쓰려 했다. 두 예외를 갈라놓은 이유는 서버 로그에서 "만료로 끊긴 것"과
 * "로그아웃 후 되살리려 한 것"을 구분하기 위해서다 — 후자는 토큰 유출 정황일 수 있다.
 * HTTP 응답은 둘 다 401 `UNAUTHENTICATED`로 같다. 클라이언트가 할 일이 재로그인으로
 * 똑같기 때문이다.
 */
export class SessionExpiredError extends DomainError {
  static readonly CODE = 'SESSION_EXPIRED';
  readonly code = SessionExpiredError.CODE;

  constructor(sessionId: string) {
    super(`세션이 만료되었습니다: ${sessionId}`);
  }
}

/** 폐기(로그아웃)된 세션을 쓰려 했다. */
export class SessionRevokedError extends DomainError {
  static readonly CODE = 'SESSION_REVOKED';
  readonly code = SessionRevokedError.CODE;

  constructor(sessionId: string) {
    super(`폐기된 세션입니다: ${sessionId}`);
  }
}
