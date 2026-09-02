import type { CustomerId } from '../../../../shared/kernel/identifiers';
import type {
  FindCustomerByAccountCommand,
  FindCustomerByAccountQuery,
} from '../ports/in/queries/find-customer-by-account.query';
import type { CustomerRepository } from '../ports/out/customer.repository';

export class FindCustomerByAccountService implements FindCustomerByAccountQuery {
  constructor(private readonly customers: CustomerRepository) {}

  async execute(command: FindCustomerByAccountCommand): Promise<CustomerId | null> {
    const customer = await this.customers.findByAccountId(command.accountId);
    return customer?.id ?? null;
  }
}
