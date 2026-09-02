import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import type { IssuedAccessToken, TokenIssuer } from '../ports/out/token-issuer';

export interface MintedTokens {
  readonly refreshToken: string;
  readonly refreshTokenHash: string;
  readonly access: IssuedAccessToken;
}

/**
 * 세 유스케이스(가입·로그인·갱신)가 공통으로 하는 일. 원본 리프레시 토큰과 그 해시를
 * 함께 돌려주는 것이 요점이다 — 원본은 클라이언트로, 해시는 DB로 간다. 이 짝을 각
 * 서비스가 따로 만들면 한 곳에서 원본을 저장하는 실수가 조용히 들어올 수 있다.
 */
export async function mintSessionTokens(
  tokens: TokenIssuer,
  principal: Principal,
): Promise<MintedTokens> {
  const refreshToken = tokens.generateRefreshToken();
  return {
    refreshToken,
    refreshTokenHash: tokens.hashRefreshToken(refreshToken),
    access: await tokens.issueAccessToken(principal),
  };
}
