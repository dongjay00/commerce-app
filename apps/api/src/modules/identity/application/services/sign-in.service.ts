import type { Duration } from '../../../../shared/kernel/duration';
import { SessionId } from '../../../../shared/kernel/identifiers';
import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import { InvalidCredentialsError } from '../../domain/account.errors';
import { Email } from '../../domain/email';
import { PlainPassword } from '../../domain/plain-password';
import { Session } from '../../domain/session';
import type { SignInCommand, SignInUseCase } from '../ports/in/sign-in.usecase';
import type { SessionTokens } from '../ports/in/sign-up.usecase';
import type { AccountRepository } from '../ports/out/account.repository';
import type { CustomerDirectory } from '../ports/out/customer-directory';
import { CustomerNotProvisionedError } from '../ports/out/customer-directory';
import type { PasswordHasher } from '../ports/out/password-hasher';
import type { SessionRepository } from '../ports/out/session.repository';
import type { TokenIssuer } from '../ports/out/token-issuer';
import { mintSessionTokens } from './mint-session-tokens';

/**
 * 로그인은 트랜잭션을 열지 않는다. 쓰기가 세션 행 하나뿐이라 원자성을 보장할 대상이 없다.
 */
export class SignInService implements SignInUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly customers: CustomerDirectory,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly refreshTtl: Duration,
  ) {}

  async execute(command: SignInCommand): Promise<SessionTokens> {
    // 형식·정책 위반도 전부 InvalidCredentialsError로 뭉갠다. 로그인 입력은 "정책을
    // 만족하는 새 비밀번호"가 아니라 "예전에 정한 비밀번호"이고, 여기서 정책 위반을
    // 알려주면 저장된 비밀번호의 성질이 새어 나간다.
    const email = SignInService.parseEmail(command.email);
    const password = SignInService.parsePassword(command.password);

    const account = email === null ? null : await this.accounts.findByEmail(email);
    if (account === null || password === null) {
      throw new InvalidCredentialsError();
    }

    if (!(await this.hasher.verify(account.credential, password))) {
      throw new InvalidCredentialsError();
    }

    const customerId = await this.customers.findByAccount(account.id);
    if (customerId === null) {
      throw new CustomerNotProvisionedError(account.id);
    }

    const principal: Principal = { accountId: account.id, customerId };
    const minted = await mintSessionTokens(this.tokens, principal);
    const now = this.clock.now();

    await this.sessions.save(
      Session.issue({
        id: SessionId.of(this.ids.nextId()),
        accountId: account.id,
        refreshTokenHash: minted.refreshTokenHash,
        now,
        ttl: this.refreshTtl,
      }),
    );

    return {
      accessToken: minted.access.token,
      refreshToken: minted.refreshToken,
      expiresInSeconds: minted.access.expiresInSeconds,
    };
  }

  private static parseEmail(raw: string): Email | null {
    try {
      return Email.of(raw);
    } catch {
      return null;
    }
  }

  private static parsePassword(raw: string): PlainPassword | null {
    try {
      return PlainPassword.of(raw);
    } catch {
      return null;
    }
  }
}
