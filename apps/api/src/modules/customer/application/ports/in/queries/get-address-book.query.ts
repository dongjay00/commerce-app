import type { CustomerId } from '../../../../../../shared/kernel/identifiers';
import type { AddressView } from '../../out/address.query';

export interface GetAddressBookCommand {
  readonly customerId: CustomerId;
}

export interface GetAddressBookQuery {
  execute(command: GetAddressBookCommand): Promise<AddressView[]>;
}

export const GET_ADDRESS_BOOK_QUERY = Symbol('GetAddressBookQuery');
