import type {
  GetAddressBookCommand,
  GetAddressBookQuery,
} from '../ports/in/queries/get-address-book.query';
import type { AddressQuery, AddressView } from '../ports/out/address.query';

/**
 * 조회는 애그리거트를 거치지 않는다 (스펙 §7.2). `Customer`를 재구성하면 불변식 검증
 * 비용을 조회에까지 물리고, 화면에 필요 없는 것까지 로딩한다.
 */
export class GetAddressBookService implements GetAddressBookQuery {
  constructor(private readonly addresses: AddressQuery) {}

  async execute(command: GetAddressBookCommand): Promise<AddressView[]> {
    return this.addresses.listByCustomer(command.customerId);
  }
}
