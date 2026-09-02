import type { AccountId, CustomerId } from '../identifiers';

/**
 * 인증이 끝난 호출자의 신원. 유스케이스는 **오직 이것만** 받는다 (스펙 결정 6).
 * 토큰 문자열, 헤더, 쿠키는 인바운드 어댑터 밖으로 나가지 않는다.
 *
 * `customerId`를 함께 담는 이유: 계정과 고객은 가입 시점에 1:1로 만들어지고, 주소록
 * 엔드포인트는 매 요청마다 그 매핑을 필요로 한다. 토큰이 들고 다니면 요청당 조회가 없다.
 */
export interface Principal {
  readonly accountId: AccountId;
  readonly customerId: CustomerId;
}

/**
 * 액세스 토큰을 검증해 Principal로 바꾸는 포트.
 *
 * 스펙 §7.3의 횡단 포트 목록(Clock/IdGenerator/TransactionManager/DomainEventPublisher)에
 * 없던 다섯 번째다. 여기 두는 이유는 순환 참조 회피다 — identity 모듈 안에 두면
 * customer의 컨트롤러가 identity를 import하게 되는데, identity는 가입 시 customer를
 * 만들려고 이미 customer를 import한다. 두 방향이 동시에 생기면 `no-circular`가 발화한다.
 * 인증 자체는 도메인 개념이 아니라 어느 모듈의 컨트롤러에나 필요한 횡단 관심사다.
 *
 * 실패 시 던지는 예외는 어댑터가 정한다 (`UnauthenticatedError`, 401).
 */
export interface AccessTokenVerifier {
  verify(token: string): Promise<Principal>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('AccessTokenVerifier');
