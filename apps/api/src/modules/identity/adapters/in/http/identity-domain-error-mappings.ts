import { ErrorCode } from '@commerce/contracts';
import type { DomainErrorRegistry } from '../../../../../shared/infrastructure/http/domain-error.registry';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  SamePasswordError,
} from '../../../domain/account.errors';
import { InvalidEmailError } from '../../../domain/email';
import { PasswordPolicyViolationError } from '../../../domain/plain-password';
import {
  SessionExpiredError,
  SessionNotFoundError,
  SessionRevokedError,
} from '../../../domain/session.errors';

export function registerIdentityDomainErrors(registry: DomainErrorRegistry): void {
  registry.register(EmailAlreadyRegisteredError.CODE, {
    status: 409,
    code: ErrorCode.EMAIL_ALREADY_REGISTERED,
  });
  registry.register(InvalidCredentialsError.CODE, {
    status: 401,
    code: ErrorCode.INVALID_CREDENTIALS,
  });
  registry.register(InvalidEmailError.CODE, {
    status: 400,
    code: ErrorCode.VALIDATION_FAILED,
  });
  registry.register(PasswordPolicyViolationError.CODE, {
    status: 422,
    code: ErrorCode.PASSWORD_POLICY_VIOLATED,
  });
  registry.register(SamePasswordError.CODE, {
    status: 422,
    code: ErrorCode.PASSWORD_POLICY_VIOLATED,
  });
  // 세 가지 세션 실패는 모두 401 UNAUTHENTICATED다. 도메인 예외를 갈라둔 것은
  // 서버 로그에서 "만료"와 "로그아웃 후 재사용"을 구분하기 위해서지, 클라이언트가
  // 다르게 행동해야 해서가 아니다 — 어느 쪽이든 할 일은 재로그인이다.
  for (const errorClass of [SessionExpiredError, SessionRevokedError, SessionNotFoundError]) {
    registry.register(errorClass.CODE, { status: 401, code: ErrorCode.UNAUTHENTICATED });
  }
}
