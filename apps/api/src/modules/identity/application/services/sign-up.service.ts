import type { Duration } from '../../../../shared/kernel/duration';
import { AccountId, SessionId } from '../../../../shared/kernel/identifiers';
import type { Principal } from '../../../../shared/kernel/ports/access-token-verifier';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { DomainEventPublisher } from '../../../../shared/kernel/ports/domain-event.publisher';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { Account } from '../../domain/account';
import { EmailAlreadyRegisteredError } from '../../domain/account.errors';
import { Email } from '../../domain/email';
import { PlainPassword } from '../../domain/plain-password';
import { Session } from '../../domain/session';
import type { SessionTokens, SignUpCommand, SignUpUseCase } from '../ports/in/sign-up.usecase';
import type { AccountRepository } from '../ports/out/account.repository';
import type { CustomerDirectory } from '../ports/out/customer-directory';
import type { EmailSender } from '../ports/out/email-sender';
import type { PasswordHasher } from '../ports/out/password-hasher';
import type { SessionRepository } from '../ports/out/session.repository';
import type { TokenIssuer } from '../ports/out/token-issuer';
import { mintSessionTokens } from './mint-session-tokens';

export class SignUpService implements SignUpUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly customers: CustomerDirectory,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly emails: EmailSender,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: DomainEventPublisher,
    private readonly refreshTtl: Duration,
  ) {}

  async execute(command: SignUpCommand): Promise<SessionTokens> {
    // 값 객체 생성이 먼저다. 형식·정책 위반을 해싱 전에 값싸게 거절한다 —
    // Argon2는 요청당 100ms 안팎이라 이 순서가 뒤집히면 느린 경로가 열린다.
    const email = Email.of(command.email);
    const password = PlainPassword.of(command.password);

    // 해싱은 트랜잭션 **밖**에서 한다. 안에서 하면 DB 커넥션을 100ms 동안 붙잡는다.
    const credential = await this.hasher.hash(password);
    const now = this.clock.now();

    const result = await this.transactions.run(async (tx) => {
      // 사전 조회는 좋은 에러 메시지를 위한 것이지 유일성의 근거가 아니다.
      // 두 요청이 동시에 여기를 통과할 수 있고, 그때는 아래 save()가 DB의 unique
      // 인덱스에 걸려 같은 예외를 던진다 (어댑터가 P2002를 번역한다).
      const existing = await this.accounts.findByEmail(email, tx);
      if (existing !== null) {
        throw new EmailAlreadyRegisteredError(email.value);
      }

      const account = Account.register({
        id: AccountId.of(this.ids.nextId()),
        email,
        credential,
        now,
      });
      await this.accounts.save(account, tx);
      // 애그리거트 저장과 같은 트랜잭션에서 outbox에 넣는다 — 이벤트 유실을 막는
      // 유일한 방법이다 (스펙 §6.3).
      await this.events.publish(account.pullEvents(), tx);

      const customerId = await this.customers.provision(account.id, tx);
      const principal: Principal = { accountId: account.id, customerId };

      const minted = await mintSessionTokens(this.tokens, principal);
      await this.sessions.save(
        Session.issue({
          id: SessionId.of(this.ids.nextId()),
          accountId: account.id,
          refreshTokenHash: minted.refreshTokenHash,
          now,
          ttl: this.refreshTtl,
        }),
        tx,
      );

      return {
        accessToken: minted.access.token,
        refreshToken: minted.refreshToken,
        expiresInSeconds: minted.access.expiresInSeconds,
      };
    });

    // 커밋 뒤에 보낸다. 트랜잭션이 롤백됐는데 환영 메일만 나가는 일이 없다.
    // 발송 실패가 가입을 되돌리지도 않는다 — 계정은 이미 있는데 사용자에게는 실패로
    // 보이면, 다시 시도할 때 409가 나면서 계정이 잠긴다.
    await this.sendWelcomeEmail(email.value);

    return result;
  }

  private async sendWelcomeEmail(to: string): Promise<void> {
    try {
      await this.emails.send({
        to,
        subject: '가입을 환영합니다',
        body: `${to} 계정이 생성되었습니다.`,
      });
    } catch {
      // 의도적으로 삼킨다. 실제 발송이 붙는 시점에 재시도 큐로 바꾼다.
    }
  }
}
