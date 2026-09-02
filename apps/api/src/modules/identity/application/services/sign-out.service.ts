import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { SignOutCommand, SignOutUseCase } from '../ports/in/sign-out.usecase';
import type { SessionRepository } from '../ports/out/session.repository';
import type { TokenIssuer } from '../ports/out/token-issuer';

export class SignOutService implements SignOutUseCase {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(command: SignOutCommand): Promise<void> {
    const session = await this.sessions.findByRefreshTokenHash(
      this.tokens.hashRefreshToken(command.refreshToken),
    );
    if (session === null) {
      // 멱등. 이미 회전됐거나 애초에 없던 토큰이다. 실패로 답하면 클라이언트가
      // 재시도 루프에 빠지고, "그 토큰은 있었다"는 정보만 새어 나간다.
      return;
    }

    session.revoke(this.clock.now());
    await this.sessions.save(session);
  }
}
