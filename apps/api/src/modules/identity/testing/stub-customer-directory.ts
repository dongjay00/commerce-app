// CustomerId는 타입이자 팩토리 값이다 — 한 번의 값 import로 둘 다 얻는다.
import { type AccountId, CustomerId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { CustomerDirectory } from '../application/ports/out/customer-directory';

/**
 * Customer 컨텍스트 대역. identity의 유스케이스 테스트는 실제 Customer 모듈을 알 필요가
 * 없다 — 그게 ACL을 둔 이유다.
 */
export class StubCustomerDirectory implements CustomerDirectory {
  readonly provisioned: AccountId[] = [];
  private readonly byAccount = new Map<string, CustomerId>();
  private counter = 0;

  async provision(accountId: AccountId, _tx: TransactionContext): Promise<CustomerId> {
    this.provisioned.push(accountId);
    const existing = this.byAccount.get(accountId);
    if (existing) {
      return existing;
    }
    this.counter += 1;
    const customerId = CustomerId.of(
      `018f2b1c-4a5d-7e6f-8a9b-0c1daaaa${this.counter.toString(16).padStart(4, '0')}`,
    );
    this.byAccount.set(accountId, customerId);
    return customerId;
  }

  async findByAccount(accountId: AccountId): Promise<CustomerId | null> {
    return this.byAccount.get(accountId) ?? null;
  }
}
