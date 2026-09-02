import { DomainError } from '../../kernel/domain-error';

/**
 * 인증되지 않았다. 인바운드 어댑터(가드·토큰 검증)에서만 던진다 — 스펙 결정 6대로
 * 인증은 어댑터의 관심사다.
 *
 * `DomainError`를 상속하는 이유는 순전히 배관이다: 기존 `DomainExceptionFilter` 하나가
 * 모든 예외 → HTTP 매핑을 담당하고, 그 필터는 `@Catch(DomainError)`로 잡는다.
 * 여기서 `HttpException`을 던지면 매핑 지점이 두 곳이 되고 `ErrorDto` 형태도 갈린다.
 */
export class UnauthenticatedError extends DomainError {
  static readonly CODE = 'UNAUTHENTICATED';
  readonly code = UnauthenticatedError.CODE;

  constructor(message = '인증이 필요합니다.') {
    super(message);
  }
}
