import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { AccountId, CustomerId } from '../../kernel/identifiers';
import type { AccessTokenVerifier, Principal } from '../../kernel/ports/access-token-verifier';
import { UnauthenticatedError } from '../http/unauthenticated.error';
import type { JwtConfig } from './jwt.config';

const ALGORITHM = 'HS256';

/**
 * 액세스 토큰의 발급과 검증을 한 클래스가 담당한다.
 *
 * 갈라놓으면 비밀키·알고리즘·클레임 이름이 두 곳에 생기고, 어긋나도 각자의 단위
 * 테스트는 통과한다. identity의 `TokenIssuer` 어댑터는 이 클래스에 위임한다 —
 * 그래서 발급-검증 왕복이 이 파일의 테스트 하나로 고정된다.
 *
 * 이 클래스가 `shared/infrastructure`에 있는 이유는 커널 포트 `AccessTokenVerifier`의
 * 구현이기 때문이다. 모든 모듈의 가드가 이것을 쓴다.
 */
@Injectable()
export class JwtTokenService implements AccessTokenVerifier {
  constructor(private readonly config: JwtConfig) {}

  issue(principal: Principal): { token: string; expiresInSeconds: number } {
    const token = jwt.sign({ cid: principal.customerId }, this.config.secret, {
      subject: principal.accountId,
      algorithm: ALGORITHM,
      expiresIn: this.config.accessTokenTtlSeconds,
    });
    return { token, expiresInSeconds: this.config.accessTokenTtlSeconds };
  }

  async verify(token: string): Promise<Principal> {
    try {
      // algorithms를 명시하지 않으면 라이브러리가 토큰 헤더의 alg를 믿는다.
      const payload = jwt.verify(token, this.config.secret, { algorithms: [ALGORITHM] });
      if (typeof payload === 'string') {
        throw new Error('payload가 객체가 아닙니다.');
      }

      // 식별자 복원도 try 안에 있어야 한다. AccountId.of는 InvalidIdError(400)를
      // 던지는데, 조작된 토큰에 400을 돌려주면 "당신의 요청 형식이 틀렸다"고
      // 거짓말하게 된다.
      return {
        accountId: AccountId.of(String(payload.sub ?? '')),
        customerId: CustomerId.of(String(payload['cid'] ?? '')),
      };
    } catch {
      throw new UnauthenticatedError('토큰이 유효하지 않습니다.');
    }
  }
}
