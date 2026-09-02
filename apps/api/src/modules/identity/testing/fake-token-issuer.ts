import type { Principal } from '../../../shared/kernel/ports/access-token-verifier';
import type { IssuedAccessToken, TokenIssuer } from '../application/ports/out/token-issuer';

/**
 * 결정적 토큰 발급기. 테스트가 발급된 토큰의 정확한 문자열을 단언할 수 있게 한다.
 * 액세스 토큰에 principal을 그대로 인코딩해, 유스케이스가 올바른 principal을 넘겼는지
 * 토큰만 보고 확인할 수 있다.
 */
export class FakeTokenIssuer implements TokenIssuer {
  private refreshCounter = 0;

  constructor(readonly expiresInSeconds: number = 900) {}

  async issueAccessToken(principal: Principal): Promise<IssuedAccessToken> {
    return {
      token: `access:${principal.accountId}:${principal.customerId}`,
      expiresInSeconds: this.expiresInSeconds,
    };
  }

  generateRefreshToken(): string {
    this.refreshCounter += 1;
    return `refresh-${this.refreshCounter}`;
  }

  hashRefreshToken(token: string): string {
    return `h(${token})`;
  }
}
