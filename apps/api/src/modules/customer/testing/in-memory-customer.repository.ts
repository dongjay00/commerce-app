import type { AccountId, CustomerId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { CustomerRepository } from '../application/ports/out/customer.repository';
import { Customer } from '../domain/customer';
import { SavedAddress } from '../domain/saved-address';

/**
 * 단위 테스트용 CustomerRepository.
 *
 * 저장·조회 시 깊은 복사를 한다. `SavedAddress`는 불변이지만 `copy`가 새 인스턴스를
 * 만들지 않으면 배열 자체(원본의 `addresses`)를 공유하게 돼, 원본에서 주소를 추가·삭제한
 * 효과가 저장본에도 반영된다 — 계약 테스트의 "저장 후 원본을 변경해도 저장본은
 * 바뀌지 않는다"가 이걸 잡는다.
 */
export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly byId = new Map<string, Customer>();

  async findById(id: CustomerId, _tx?: TransactionContext): Promise<Customer | null> {
    const stored = this.byId.get(id);
    return stored ? InMemoryCustomerRepository.copy(stored) : null;
  }

  async findByAccountId(accountId: AccountId, _tx?: TransactionContext): Promise<Customer | null> {
    for (const stored of this.byId.values()) {
      if (stored.accountId === accountId) {
        return InMemoryCustomerRepository.copy(stored);
      }
    }
    return null;
  }

  async save(customer: Customer, _tx?: TransactionContext): Promise<void> {
    this.byId.set(customer.id, InMemoryCustomerRepository.copy(customer));
  }

  private static copy(customer: Customer): Customer {
    return Customer.rehydrate({
      id: customer.id,
      accountId: customer.accountId,
      createdAt: new Date(customer.createdAt.getTime()),
      // SavedAddress도 새 인스턴스여야 한다. 같은 인스턴스를 배열에 공유하면 원본
      // 배열에 대한 add/remove가 저장본의 배열에도 반영된다.
      addresses: customer.addressBook.all.map(
        (address) => new SavedAddress(address.id, address.details, address.isDefault),
      ),
    });
  }
}
