import type { Duration } from '../../../../shared/kernel/duration';
import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import { SessionNotFoundError } from '../../domain/session.errors';
import type {
  RefreshSessionCommand,
  RefreshSessionUseCase,
} from '../ports/in/refresh-session.usecase';
import type { SessionTokens } from '../ports/in/sign-up.usecase';
import type { CustomerDirectory } from '../ports/out/customer-directory';
import { CustomerNotProvisionedError } from '../ports/out/customer-directory';
import type { SessionRepository } from '../ports/out/session.repository';
import type { TokenIssuer } from '../ports/out/token-issuer';
import { mintSessionTokens } from './mint-session-tokens';

/**
 * 리프레시 토큰을 회전시킨다.
 *
 * 트랜잭션을 열지 않는다 — 쓰기가 세션 행 하나뿐이다. 다만 **회전 실패가 세션을
 * 망가뜨리지 않도록** `Session.rotate`가 상태 변경 전에 전부 검사한다.
 */
export class RefreshSessionService implements RefreshSessionUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly customers: CustomerDirectory,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
    private readonly refreshTtl: Duration,
  ) {}

  async execute(command: RefreshSessionCommand): Promise<SessionTokens> {
    const session = await this.sessions.findByRefreshTokenHash(
      this.tokens.hashRefreshToken(command.refreshToken),
    );
    if (session === null) {
      throw new SessionNotFoundError();
    }

    const customerId = await this.customers.findByAccount(session.accountId);
    if (customerId === null) {
      throw new CustomerNotProvisionedError(session.accountId);
    }

    const principal: Principal = { accountId: session.accountId, customerId };
    const minted = await mintSessionTokens(this.tokens, principal);

    // rotate가 만료·폐기를 먼저 검사하고 던진다. 여기서 던지면 아래 save에 도달하지 않아
    // 기존 세션이 그대로 남는다.
    session.rotate({
      refreshTokenHash: minted.refreshTokenHash,
      now: this.clock.now(),
      ttl: this.refreshTtl,
    });
    await this.sessions.save(session);

    return {
      accessToken: minted.access.token,
      refreshToken: minted.refreshToken,
      expiresInSeconds: minted.access.expiresInSeconds,
    };
  }
}
