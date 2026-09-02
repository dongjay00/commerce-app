import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 주입이 깨진다.
import { JwtTokenService } from '../../../../../shared/infrastructure/auth/jwt-token.service';
import type { Principal } from '../../../../../shared/kernel/ports/access-token-verifier';
import type { IssuedAccessToken, TokenIssuer } from '../../../application/ports/out/token-issuer';

const REFRESH_TOKEN_BYTES = 32;

/**
 * 액세스 토큰은 `JwtTokenService`에 위임한다 — 검증하는 쪽과 같은 코드를 쓰게 해
 * 비밀키와 클레임이 갈라질 수 없게 만든다.
 *
 * 리프레시 토큰은 여기서 만든다. **JWT가 아니라 불투명 난수다.** 자기 완결적 토큰이면
 * 로그아웃해도 만료 시각까지 유효한 토큰이 남아, `sessions` 테이블을 둔 이유(즉시
 * 무효화)가 통째로 사라진다.
 *
 * 해싱에 SHA-256을 쓴다. 비밀번호와 달리 이 입력은 256비트 난수라 무차별 대입 자체가
 * 불가능하므로, Argon2의 느림이 사줄 안전이 없고 갱신 요청마다 100ms를 더할 뿐이다.
 */
@Injectable()
export class JwtTokenIssuer implements TokenIssuer {
  constructor(private readonly jwt: JwtTokenService) {}

  async issueAccessToken(principal: Principal): Promise<IssuedAccessToken> {
    return this.jwt.issue(principal);
  }

  generateRefreshToken(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
