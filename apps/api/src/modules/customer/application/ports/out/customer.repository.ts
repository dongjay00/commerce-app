import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Customer } from '../../../domain/customer';

/**
 * `save`는 주소록 전체를 함께 저장한다 — `SavedAddress`는 애그리거트 **안**이라
 * 따로 저장할 방법이 없어야 한다. 어댑터가 삭제된 주소의 행을 지우는 것까지 책임진다.
 */
export interface CustomerRepository {
  findById(id: CustomerId, tx?: TransactionContext): Promise<Customer | null>;
  findByAccountId(accountId: AccountId, tx?: TransactionContext): Promise<Customer | null>;
  save(customer: Customer, tx?: TransactionContext): Promise<void>;
}

export const CUSTOMER_REPOSITORY = Symbol('CustomerRepository');
