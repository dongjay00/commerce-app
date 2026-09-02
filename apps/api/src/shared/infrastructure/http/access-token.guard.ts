import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type Principal,
} from '../../kernel/ports/access-token-verifier';
import { UnauthenticatedError } from './unauthenticated.error';

const SCHEME = 'Bearer ';

/** 가드가 채우는 요청 확장. 컨트롤러는 `@CurrentPrincipal()`로만 읽는다. */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

/**
 * 스펙 결정 6의 구현: 인증은 인바운드 어댑터의 관심사다. 유스케이스는 확인된
 * `Principal`만 받고 토큰·헤더·쿠키를 모른다.
 *
 * `shared/infrastructure`에 있는 이유는 identity와 customer 양쪽 컨트롤러가 쓰기
 * 때문이다. identity 안에 두면 customer가 identity를 import하게 되고, identity는
 * 가입 시 customer를 import하므로 순환이 생긴다.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(@Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers['authorization'];

    if (typeof header !== 'string' || !header.startsWith(SCHEME)) {
      throw new UnauthenticatedError('인증 토큰이 없습니다.');
    }

    const token = header.slice(SCHEME.length);
    if (token.length === 0) {
      // 빈 문자열을 검증기에 넘기면 어댑터마다 다르게 실패한다. 여기서 막는다.
      throw new UnauthenticatedError('인증 토큰이 비어 있습니다.');
    }

    request.principal = await this.verifier.verify(token);
    return true;
  }
}
