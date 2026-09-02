import { randomBytes } from 'node:crypto';
import type { Duration } from '../../../../shared/kernel/duration';
import { SessionId } from '../../../../shared/kernel/identifiers';
import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import { InvalidCredentialsError } from '../../domain/account.errors';
import type { Credential } from '../../domain/credential';
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
  // 존재하지 않는 이메일도 실제 계정과 같은 만큼의 해싱 비용을 치르게 하는 더미 해시.
  // 생성자에서 한 번만 만들어 요청마다 다시 해싱하지 않는다 — 무작위 평문을 매 요청
  // 새로 해싱하면 그 자체가 또 다른 시간차 신호가 된다. 계정 존재 여부가 타이밍으로
  // 새어 나가면(Argon2 검증을 하느냐 마느냐로 갈리면) InvalidCredentialsError의 메시지를
  // 통일한 의미가 없어진다 — 아래 execute의 주석 참고.
  private readonly dummyCredential: Promise<Credential>;

  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly customers: CustomerDirectory,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly refreshTtl: Duration,
  ) {
    this.dummyCredential = this.hasher.hash(
      PlainPassword.of(randomBytes(32).toString('base64url')),
    );
  }

  async execute(command: SignInCommand): Promise<SessionTokens> {
    // 형식·정책 위반도 전부 InvalidCredentialsError로 뭉갠다. 로그인 입력은 "정책을
    // 만족하는 새 비밀번호"가 아니라 "예전에 정한 비밀번호"이고, 여기서 정책 위반을
    // 알려주면 저장된 비밀번호의 성질이 새어 나간다.
    const email = SignInService.parseEmail(command.email);
    const password = SignInService.parsePassword(command.password);

    const account = email === null ? null : await this.accounts.findByEmail(email);

    // 계정이 없어도(또는 비밀번호 형식이 틀려도) 항상 해셔를 호출한다 — 존재하는
    // 계정의 비밀번호가 틀렸을 때와 같은 만큼의 시간이 걸리게 하기 위해서다. 계정이
    // 없을 때만 즉시 반환하면, 그 응답 시간 차이 자체가 "이 이메일은 가입돼 있다"는
    // 사실을 알려주는 오라클이 된다 — 메시지를 통일한 것과 같은 이유다.
    const candidate = account?.credential ?? (await this.dummyCredential);
    const verified = password === null ? false : await this.hasher.verify(candidate, password);
    if (account === null || !verified) {
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
