import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';

export interface IssuedAccessToken {
  readonly token: string;
  /** 클라이언트가 만료를 미리 알 수 있게 함께 준다. */
  readonly expiresInSeconds: number;
}

/**
 * 토큰 발급 포트.
 *
 * 액세스 토큰과 리프레시 토큰은 **성질이 다르다.** 액세스 토큰은 자기 완결적 JWT라
 * 검증에 DB가 필요 없고(그래서 짧다), 리프레시 토큰은 불투명 난수라 `sessions` 행을
 * 찾아야만 의미가 생긴다(그래서 즉시 무효화가 된다). 자기 완결적 리프레시 토큰을 쓰면
 * 로그아웃해도 만료까지 유효한 토큰이 살아 있다.
 *
 * 스펙 §7.6의 포트 목록을 지키기 위해 둘을 한 포트에 담았다. 어댑터는 하나다.
 */
export interface TokenIssuer {
  issueAccessToken(principal: Principal): Promise<IssuedAccessToken>;
  /** 암호학적 난수. 이 값만 클라이언트에 나가고 서버에는 해시만 남는다. */
  generateRefreshToken(): string;
  /** 결정적 해시. 같은 토큰은 항상 같은 해시가 되어야 조회가 성립한다. */
  hashRefreshToken(token: string): string;
}

export const TOKEN_ISSUER = Symbol('TokenIssuer');
