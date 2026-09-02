import { AccountId, AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import { AddressDetails } from '../../../domain/address-details';
import { Customer } from '../../../domain/customer';
import { SavedAddress } from '../../../domain/saved-address';

export interface SavedAddressRow {
  id: string;
  customerId: string;
  label: string;
  recipient: string;
  phone: string;
  zip: string;
  line1: string;
  line2: string | null;
  isDefault: boolean;
}

export interface CustomerRow {
  id: string;
  accountId: string;
  createdAt: Date;
  addresses: SavedAddressRow[];
}

/**
 * M7: 영속 복원에는 `fromPersistence`를 쓴다. 깨진 행은 400이 아니라 500이다.
 * `CustomerId`/`AccountId`/`AddressId`의 `fromPersistence`뿐 아니라
 * `AddressDetails.fromPersistence`도 마찬가지다 — 빈 칸이 저장된 행을 `of`로
 * 복원하면 `InvalidAddressError`(400)가 나가 멀쩡한 요청을 거짓으로 거절하게 된다.
 */
export function toCustomerDomain(row: CustomerRow): Customer {
  return Customer.rehydrate({
    id: CustomerId.fromPersistence(row.id),
    accountId: AccountId.fromPersistence(row.accountId),
    createdAt: row.createdAt,
    addresses: row.addresses.map(
      (address) =>
        new SavedAddress(
          AddressId.fromPersistence(address.id),
          AddressDetails.fromPersistence({
            label: address.label,
            recipient: address.recipient,
            phone: address.phone,
            zip: address.zip,
            line1: address.line1,
            line2: address.line2,
          }),
          address.isDefault,
        ),
    ),
  });
}

export function toSavedAddressRows(customer: Customer): SavedAddressRow[] {
  return customer.addressBook.all.map((address) => ({
    id: address.id,
    customerId: customer.id,
    label: address.details.label,
    recipient: address.details.recipient,
    phone: address.details.phone,
    zip: address.details.zip,
    line1: address.details.line1,
    line2: address.details.line2,
    isDefault: address.isDefault,
  }));
}
