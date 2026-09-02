import { describe, expect, it } from 'vitest';
import { AccountId, AddressId, CustomerId } from '../../../shared/kernel/identifiers';
import { AddressDetails } from './address-details';
import { Customer } from './customer';
import { AddressNotFoundError } from './customer.errors';
import { SavedAddress } from './saved-address';

const CUSTOMER_ID = CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dbbbb0001');
const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dbbbb0002');
const ADDRESS_ID = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dbbbb0003');
const OTHER_ADDRESS_ID = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dbbbb0004');
const NOW = new Date('2026-03-01T10:00:00.000Z');

function details(label = '집'): AddressDetails {
  return AddressDetails.of({
    label,
    recipient: '홍길동',
    phone: '010-1234-5678',
    zip: '06236',
    line1: '서울시 강남구 테헤란로 1',
  });
}

describe('Customer', () => {
  it('빈 주소록으로 만들어진다', () => {
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: NOW });
    expect(customer.createdAt).toEqual(NOW);
    expect(customer.addressBook.all).toEqual([]);
  });

  it('주소 추가·수정·기본 지정·삭제를 주소록에 위임한다', () => {
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: NOW });

    const added = customer.addAddress(ADDRESS_ID, details());
    expect(added.isDefault).toBe(true);

    customer.addAddress(OTHER_ADDRESS_ID, details('회사'));
    customer.setDefaultAddress(OTHER_ADDRESS_ID);
    expect(customer.addressBook.defaultAddress?.id).toBe(OTHER_ADDRESS_ID);

    customer.updateAddress(ADDRESS_ID, details('본가'));
    expect(customer.addressBook.all.find((a) => a.id === ADDRESS_ID)?.details.label).toBe('본가');

    customer.removeAddress(ADDRESS_ID);
    expect(customer.addressBook.all).toHaveLength(1);
  });

  it('다른 고객의 주소 ID로는 아무것도 할 수 없다', () => {
    // 소유권 검사가 구조적으로 보장된다 — 주소록이 애그리거트 안에 있으므로
    // 다른 고객의 ID는 애초에 이 목록에 없다.
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: NOW });
    customer.addAddress(ADDRESS_ID, details());

    expect(() => customer.updateAddress(OTHER_ADDRESS_ID, details())).toThrow(AddressNotFoundError);
    expect(() => customer.removeAddress(OTHER_ADDRESS_ID)).toThrow(AddressNotFoundError);
    expect(() => customer.setDefaultAddress(OTHER_ADDRESS_ID)).toThrow(AddressNotFoundError);
  });

  it('저장된 주소와 함께 복원된다', () => {
    const customer = Customer.rehydrate({
      id: CUSTOMER_ID,
      accountId: ACCOUNT_ID,
      createdAt: NOW,
      addresses: [new SavedAddress(ADDRESS_ID, details(), true)],
    });
    expect(customer.addressBook.defaultAddress?.id).toBe(ADDRESS_ID);
  });
});
