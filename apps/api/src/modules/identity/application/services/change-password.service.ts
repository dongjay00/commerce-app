import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { TransactionManager } from '../../../../shared/kernel/ports/transaction-manager';
import { InvalidCredentialsError, SamePasswordError } from '../../domain/account.errors';
import { PlainPassword } from '../../domain/plain-password';
import type {
  ChangePasswordCommand,
  ChangePasswordUseCase,
} from '../ports/in/change-password.usecase';
import type { AccountRepository } from '../ports/out/account.repository';
import type { PasswordHasher } from '../ports/out/password-hasher';
import type { SessionRepository } from '../ports/out/session.repository';

/**
 * 비밀번호 변경. 계정 갱신과 세션 폐기는 **같은 트랜잭션**이다 — 갈라지면 비밀번호는
 * 바뀌었는데 옛 세션이 살아 있는 창이 생긴다. 그 창이 정확히 이 유스케이스가 닫으려는
 * 것이다.
 */
export class ChangePasswordService implements ChangePasswordUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly transactions: TransactionManager,
    private readonly clock: Clock,
  ) {}

  async execute(command: ChangePasswordCommand): Promise<void> {
    // 새 비밀번호의 정책 검사가 먼저다 — 정책을 어긴 요청에 해싱·조회 비용을 쓰지 않는다.
    const newPassword = PlainPassword.of(command.newPassword);

    const account = await this.accounts.findById(command.accountId);
    if (account === null) {
      throw new InvalidCredentialsError();
    }

    const currentPassword = ChangePasswordService.parse(command.currentPassword);
    if (
      currentPassword === null ||
      !(await this.hasher.verify(account.credential, currentPassword))
    ) {
      throw new InvalidCredentialsError();
    }

    // 해시끼리 비교할 수 없다 — Argon2는 매번 다른 솔트를 쓴다. 새 평문을 현재 해시에
    // 대조하는 것이 유일한 방법이다.
    if (await this.hasher.verify(account.credential, newPassword)) {
      throw new SamePasswordError();
    }

    const next = await this.hasher.hash(newPassword);
    const now = this.clock.now();

    await this.transactions.run(async (tx) => {
      account.changeCredential(next, now);
      await this.accounts.save(account, tx);
      await this.sessions.revokeAllForAccount(account.id, now, tx);
    });
  }

  private static parse(raw: string): PlainPassword | null {
    try {
      return PlainPassword.of(raw);
    } catch {
      return null;
    }
  }
}
