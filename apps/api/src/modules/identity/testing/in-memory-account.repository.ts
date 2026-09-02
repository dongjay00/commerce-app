import type { AccountId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { AccountRepository } from '../application/ports/out/account.repository';
import { Account } from '../domain/account';
import { EmailAlreadyRegisteredError } from '../domain/account.errors';
import type { Email } from '../domain/email';

/**
 * 단위 테스트용 AccountRepository.
 *
 * 두 가지를 실물과 똑같이 흉내낸다. 둘 다 빠뜨리면 유스케이스 테스트가 fake 위에서
 * 통과하고 운영에서만 깨진다 — 계약 테스트가 이 둘을 강제한다.
 *
 * 1. **저장 시 복사한다.** 참조를 그대로 들고 있으면 저장 뒤 애그리거트를 바꾼 것이
 *    저장본에도 반영돼, 트랜잭션 롤백을 흉내낼 수 없다.
 * 2. **이메일 유일성을 강제한다.** 실물은 unique 인덱스가 P2002를 던진다.
 */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly byId = new Map<string, Account>();

  async findById(id: AccountId, _tx?: TransactionContext): Promise<Account | null> {
    const stored = this.byId.get(id);
    return stored ? InMemoryAccountRepository.copy(stored) : null;
  }

  async findByEmail(email: Email, _tx?: TransactionContext): Promise<Account | null> {
    for (const stored of this.byId.values()) {
      if (stored.email.equals(email)) {
        return InMemoryAccountRepository.copy(stored);
      }
    }
    return null;
  }

  async save(account: Account, _tx?: TransactionContext): Promise<void> {
    for (const stored of this.byId.values()) {
      if (stored.id !== account.id && stored.email.equals(account.email)) {
        throw new EmailAlreadyRegisteredError(account.email.value);
      }
    }
    this.byId.set(account.id, InMemoryAccountRepository.copy(account));
  }

  private static copy(account: Account): Account {
    return Account.rehydrate({
      id: account.id,
      email: account.email,
      credential: account.credential,
      createdAt: new Date(account.createdAt.getTime()),
      updatedAt: new Date(account.updatedAt.getTime()),
    });
  }
}
