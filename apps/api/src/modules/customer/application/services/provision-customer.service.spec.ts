import { describe, expect, it } from 'vitest';
import { AccountId } from '../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../shared/kernel/ports/transaction-manager';
import { MutableClock } from '../../../../shared/testing/mutable-clock';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import type { Customer } from '../../domain/customer';
import { FIXED_NOW } from '../../testing/customer.fixtures';
import { InMemoryCustomerRepository } from '../../testing/in-memory-customer.repository';
import { ProvisionCustomerService } from './provision-customer.service';

/**
 * `save`가 받은 `tx`를 기록하는 fake. `vi.spyOn` 대신 상속으로 만든다 — 목 라이브러리
 * 금지 규칙을 지키면서 "어떤 tx로 저장했는가"를 상태로 검증하는 방법이다.
 */
class RecordingCustomerRepository extends InMemoryCustomerRepository {
  saveCalls: Array<{ customer: Customer; tx: TransactionContext | undefined }> = [];

  override async save(customer: Customer, tx?: TransactionContext): Promise<void> {
    this.saveCalls.push({ customer, tx });
    await super.save(customer, tx);
  }
}

function build(overrides: { customers?: InMemoryCustomerRepository } = {}) {
  const customers = overrides.customers ?? new InMemoryCustomerRepository();
  const clock = new MutableClock(FIXED_NOW);
  const ids = new SequentialIdGenerator();
  const transactions = new PassthroughTransactionManager();

  const service = new ProvisionCustomerService(customers, clock, ids);

  return { service, customers, clock, ids, transactions };
}

const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dacc00001');

describe('ProvisionCustomerService', () => {
  it('새 고객을 만들고 ID를 돌려준다', async () => {
    const { service, customers, transactions } = build();

    const customerId = await transactions.run((tx) =>
      service.execute({ accountId: ACCOUNT_ID, tx }),
    );

    const saved = await customers.findById(customerId);
    expect(saved).not.toBeNull();
    expect(saved?.accountId).toBe(ACCOUNT_ID);
  });

  it('같은 계정으로 두 번 부르면 같은 ID를 돌려주고 고객이 하나만 생긴다', async () => {
    const { service, customers, transactions } = build();

    const first = await transactions.run((tx) => service.execute({ accountId: ACCOUNT_ID, tx }));
    const second = await transactions.run((tx) => service.execute({ accountId: ACCOUNT_ID, tx }));

    expect(second).toBe(first);
    const found = await customers.findByAccountId(ACCOUNT_ID);
    expect(found?.id).toBe(first);
  });

  it('생성 시각이 주입된 Clock의 값이다', async () => {
    const { service, customers, transactions } = build();

    const customerId = await transactions.run((tx) =>
      service.execute({ accountId: ACCOUNT_ID, tx }),
    );

    const saved = await customers.findById(customerId);
    expect(saved?.createdAt).toEqual(FIXED_NOW);
  });

  it('전달받은 tx를 리포지토리에 그대로 넘긴다', async () => {
    const customers = new RecordingCustomerRepository();
    const { service, transactions } = build({ customers });

    await transactions.run((tx) => service.execute({ accountId: ACCOUNT_ID, tx }));

    expect(customers.saveCalls).toHaveLength(1);
    expect(customers.saveCalls[0]?.tx).toBeDefined();
  });
});
