export interface ExternalIdentity {
  readonly provider: string;
  readonly subject: string;
  readonly email: string;
}

/**
 * 외부 IdP(소셜 로그인) 포트. **구현체가 없다.**
 *
 * 스펙 §1.3과 §7.6이 의도적으로 인터페이스만 두기로 한 자리다. 헥사고날의 가치는
 * "어댑터 하나를 더해 기능을 붙일 수 있다"는 것이고, 이 파일은 그 주장을 코드로
 * 보여주는 자리다. Nest 모듈에 바인딩되지 않으므로 주입을 시도하면 부팅이 실패한다 —
 * 그게 맞는 동작이다.
 */
export interface IdentityProvider {
  exchangeAuthorizationCode(code: string): Promise<ExternalIdentity>;
}

export const IDENTITY_PROVIDER = Symbol('IdentityProvider');
