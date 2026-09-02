import { describe, expect, it } from 'vitest';
import { AccountId, CustomerId } from '../../../../shared/kernel/identifiers';
import { Customer } from '../../domain/customer';
import { FIXED_NOW } from '../../testing/customer.fixtures';
import { InMemoryCustomerRepository } from '../../testing/in-memory-customer.repository';
import { FindCustomerByAccountService } from './find-customer-by-account.service';

const CUSTOMER_ID = CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dc05e0001');
const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dacc00001');

describe('FindCustomerByAccountService', () => {
  it('계정에 대응하는 고객이 있으면 그 ID를 돌려준다', async () => {
    const customers = new InMemoryCustomerRepository();
    const service = new FindCustomerByAccountService(customers);
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: FIXED_NOW });
    await customers.save(customer);

    expect(await service.execute({ accountId: ACCOUNT_ID })).toBe(CUSTOMER_ID);
  });

  it('대응하는 고객이 없으면 null이다', async () => {
    const customers = new InMemoryCustomerRepository();
    const service = new FindCustomerByAccountService(customers);

    expect(await service.execute({ accountId: ACCOUNT_ID })).toBeNull();
  });
});
