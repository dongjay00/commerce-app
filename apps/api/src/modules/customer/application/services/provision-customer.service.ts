import { CustomerId } from '../../../../shared/kernel/identifiers';
import type { Clock } from '../../../../shared/kernel/ports/clock';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import { Customer } from '../../domain/customer';
import type {
  ProvisionCustomerCommand,
  ProvisionCustomerUseCase,
} from '../ports/in/provision-customer.usecase';
import type { CustomerRepository } from '../ports/out/customer.repository';

export class ProvisionCustomerService implements ProvisionCustomerUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(command: ProvisionCustomerCommand): Promise<CustomerId> {
    // 멱등. 가입이 재시도되거나(네트워크 타임아웃 후) 나중에 관리자 도구가 같은 계정에
    // 고객을 만들려 해도 새 고객이 생기지 않는다. customers.account_id의 unique 인덱스도
    // 같은 것을 강제하지만, 여기서 먼저 걸러야 좋은 결과(기존 ID)를 돌려줄 수 있다.
    const existing = await this.customers.findByAccountId(command.accountId, command.tx);
    if (existing !== null) {
      return existing.id;
    }

    const customer = Customer.register({
      id: CustomerId.of(this.ids.nextId()),
      accountId: command.accountId,
      now: this.clock.now(),
    });
    await this.customers.save(customer, command.tx);
    return customer.id;
  }
}
