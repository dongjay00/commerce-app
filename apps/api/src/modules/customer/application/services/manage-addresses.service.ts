import { AddressId, type CustomerId } from '../../../../shared/kernel/identifiers';
import type { IdGenerator } from '../../../../shared/kernel/ports/id-generator';
import type {
  TransactionContext,
  TransactionManager,
} from '../../../../shared/kernel/ports/transaction-manager';
import { AddressDetails } from '../../domain/address-details';
import type { Customer } from '../../domain/customer';
import type { SavedAddress } from '../../domain/saved-address';
import type {
  AddAddressCommand,
  AddressCommand,
  ManageAddressesUseCase,
  UpdateAddressCommand,
} from '../ports/in/manage-addresses.usecase';
import type { AddressView } from '../ports/out/address.query';
import type { CustomerRepository } from '../ports/out/customer.repository';

/**
 * 토큰은 유효한데 고객 행이 없다. 가입이 계정과 고객을 한 트랜잭션에서 만들므로
 * 정상 경로로는 불가능하다 — 데이터가 깨진 것이다. `DomainError`가 아니므로 500이다.
 */
export class CustomerNotFoundError extends Error {
  constructor(customerId: string) {
    super(`고객을 찾을 수 없습니다: ${customerId}`);
    this.name = 'CustomerNotFoundError';
  }
}

export function toAddressView(address: SavedAddress): AddressView {
  return {
    id: address.id,
    label: address.details.label,
    recipient: address.details.recipient,
    phone: address.details.phone,
    zip: address.details.zip,
    line1: address.details.line1,
    line2: address.details.line2,
    isDefault: address.isDefault,
  };
}

export class ManageAddressesService implements ManageAddressesUseCase {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly transactions: TransactionManager,
    private readonly ids: IdGenerator,
  ) {}

  async add(command: AddAddressCommand): Promise<AddressView> {
    // 값 객체 생성이 트랜잭션 밖이다. 잘못된 주소로 트랜잭션을 열 이유가 없다.
    const details = AddressDetails.of(command.details);
    return this.mutateReturning(command.customerId, (customer) =>
      customer.addAddress(AddressId.of(this.ids.nextId()), details),
    );
  }

  async update(command: UpdateAddressCommand): Promise<AddressView> {
    const details = AddressDetails.of(command.details);
    return this.mutateReturning(command.customerId, (customer) =>
      customer.updateAddress(command.addressId, details),
    );
  }

  async remove(command: AddressCommand): Promise<void> {
    await this.mutateVoid(command.customerId, (customer) => {
      customer.removeAddress(command.addressId);
    });
  }

  async setDefault(command: AddressCommand): Promise<void> {
    await this.mutateVoid(command.customerId, (customer) => {
      customer.setDefaultAddress(command.addressId);
    });
  }

  /**
   * 불러오기 → 도메인 메서드 → 저장을 한 트랜잭션으로 묶는다. `setDefault`가 특히
   * 필요하다 — 이전 기본 해제와 새 기본 지정이 한 번에 커밋돼야 부분 유니크 인덱스를
   * 어기지 않는다.
   *
   * 변경된 주소를 `AddressView`로 돌려줘야 하는 `add`/`update` 전용. 반환값이 없는
   * `remove`/`setDefault`는 `mutateVoid`를 쓴다 — 조건부 반환 타입 하나로 묶는 것보다
   * 두 메서드가 읽기 쉽다.
   */
  private async mutateReturning(
    customerId: CustomerId,
    change: (customer: Customer) => SavedAddress,
  ): Promise<AddressView> {
    return this.transactions.run(async (tx) => {
      const customer = await this.loadOrThrow(customerId, tx);
      const changed = change(customer);
      await this.customers.save(customer, tx);
      return toAddressView(changed);
    });
  }

  private async mutateVoid(
    customerId: CustomerId,
    change: (customer: Customer) => void,
  ): Promise<void> {
    await this.transactions.run(async (tx) => {
      const customer = await this.loadOrThrow(customerId, tx);
      change(customer);
      await this.customers.save(customer, tx);
    });
  }

  private async loadOrThrow(customerId: CustomerId, tx: TransactionContext): Promise<Customer> {
    const customer = await this.customers.findById(customerId, tx);
    if (customer === null) {
      throw new CustomerNotFoundError(customerId);
    }
    return customer;
  }
}
