import type { AccountId, AddressId, CustomerId } from '../../../shared/kernel/identifiers';
import { AddressBook } from './address-book';
import type { AddressDetails } from './address-details';
import type { SavedAddress } from './saved-address';

/**
 * 고객 애그리거트 루트.
 *
 * `AggregateRoot`를 상속하지 않는다 — 주소록 변경을 구독하는 컨텍스트가 없고
 * (스펙 §5.6의 이벤트 목록에 customer 발행 이벤트가 없다), 상속만 해두면 리포지토리가
 * 매번 빈 `pullEvents()`를 부르는 죽은 배관이 남는다. 필요해지면 그때 붙인다.
 *
 * 계정과 1:1이지만 `Account`를 참조로 들지 않고 `accountId`만 갖는다 (스펙 §5.1).
 */
export class Customer {
  private constructor(
    readonly id: CustomerId,
    readonly accountId: AccountId,
    readonly createdAt: Date,
    private readonly book: AddressBook,
  ) {}

  static register(params: { id: CustomerId; accountId: AccountId; now: Date }): Customer {
    return new Customer(params.id, params.accountId, params.now, AddressBook.empty());
  }

  static rehydrate(params: {
    id: CustomerId;
    accountId: AccountId;
    createdAt: Date;
    addresses: SavedAddress[];
  }): Customer {
    return new Customer(
      params.id,
      params.accountId,
      params.createdAt,
      AddressBook.rehydrate(params.id, params.addresses),
    );
  }

  get addressBook(): AddressBook {
    return this.book;
  }

  addAddress(id: AddressId, details: AddressDetails): SavedAddress {
    return this.book.add(id, details);
  }

  updateAddress(id: AddressId, details: AddressDetails): SavedAddress {
    return this.book.update(id, details);
  }

  removeAddress(id: AddressId): void {
    this.book.remove(id);
  }

  setDefaultAddress(id: AddressId): void {
    this.book.setDefault(id);
  }
}
