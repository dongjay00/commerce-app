import { describe, expect, it } from 'vitest';
import { JwtTokenService } from '../../../../../shared/infrastructure/auth/jwt-token.service';
import { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import { JwtTokenIssuer } from './jwt-token.issuer';

const PRINCIPAL: Principal = {
  accountId: AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fe001'),
  customerId: CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3fe002'),
};

function build(): { issuer: JwtTokenIssuer; jwtService: JwtTokenService } {
  const jwtService = new JwtTokenService({
    secret: 'test-secret-that-is-long-enough!!',
    accessTokenTtlSeconds: 900,
  });
  return { issuer: new JwtTokenIssuer(jwtService), jwtService };
}

describe('JwtTokenIssuer', () => {
  it('발급한 액세스 토큰을 같은 서비스가 검증한다', async () => {
    const { issuer, jwtService } = build();
    const issued = await issuer.issueAccessToken(PRINCIPAL);
    await expect(jwtService.verify(issued.token)).resolves.toEqual(PRINCIPAL);
  });

  it('리프레시 토큰은 매번 다르다', () => {
    const { issuer } = build();
    const tokens = new Set(Array.from({ length: 100 }, () => issuer.generateRefreshToken()));
    expect(tokens.size).toBe(100);
  });

  it('리프레시 토큰은 최소 32바이트의 엔트로피를 갖는다', () => {
    // 추측 가능한 리프레시 토큰은 세션 탈취와 같다.
    const { issuer } = build();
    const token = issuer.generateRefreshToken();
    expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(32);
  });

  it('리프레시 토큰은 JWT가 아니다', () => {
    // 자기 완결적 토큰이면 로그아웃해도 만료까지 유효하다. 불투명 난수여야
    // sessions 행 삭제/폐기가 즉시 효력을 갖는다.
    const { issuer } = build();
    expect(issuer.generateRefreshToken()).not.toContain('.');
  });

  it('해싱은 결정적이다', () => {
    const { issuer } = build();
    const token = issuer.generateRefreshToken();
    expect(issuer.hashRefreshToken(token)).toBe(issuer.hashRefreshToken(token));
  });

  it('해시가 원본 토큰을 포함하지 않는다', () => {
    const { issuer } = build();
    const token = issuer.generateRefreshToken();
    expect(issuer.hashRefreshToken(token)).not.toContain(token);
  });

  it('다른 토큰은 다른 해시가 된다', () => {
    const { issuer } = build();
    expect(issuer.hashRefreshToken('a')).not.toBe(issuer.hashRefreshToken('b'));
  });
});
