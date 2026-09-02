import { describe, expect, it } from 'vitest';
import {
  AccountId,
  AddressId,
  CorruptedRecordError,
  CustomerId,
} from '../../../../../shared/kernel/identifiers';
import { AddressDetails } from '../../../domain/address-details';
import { Customer } from '../../../domain/customer';
import { toCustomerDomain, toSavedAddressRows } from './customer.mapper';

const CUSTOMER_ID = '018f2b1c-4a5d-7e6f-8a9b-0c1dc05ef001';
const ACCOUNT_ID = '018f2b1c-4a5d-7e6f-8a9b-0c1dacc0f001';
const ADDRESS_ID = '018f2b1c-4a5d-7e6f-8a9b-0c1dadd0f001';
const CREATED = new Date('2026-03-01T10:00:00.000Z');

const addressRow = {
  id: ADDRESS_ID,
  customerId: CUSTOMER_ID,
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: '101동',
  isDefault: true,
};

const row = {
  id: CUSTOMER_ID,
  accountId: ACCOUNT_ID,
  createdAt: CREATED,
  addresses: [addressRow],
};

describe('customer.mapper', () => {
  it('행을 애그리거트로 복원한다', () => {
    const customer = toCustomerDomain(row);
    expect(customer.id).toBe(CUSTOMER_ID);
    expect(customer.accountId).toBe(ACCOUNT_ID);
    expect(customer.createdAt).toEqual(CREATED);
  });

  it('주소록도 함께 복원한다', () => {
    const customer = toCustomerDomain(row);
    const addresses = customer.addressBook.all;
    expect(addresses).toHaveLength(1);
    expect(addresses[0]?.id).toBe(ADDRESS_ID);
    expect(addresses[0]?.isDefault).toBe(true);
    expect(addresses[0]?.details.line1).toBe('서울시 강남구 테헤란로 1');
  });

  it('line2가 null인 행도 그대로 복원한다', () => {
    const customer = toCustomerDomain({
      ...row,
      addresses: [{ ...addressRow, line2: null }],
    });
    expect(customer.addressBook.all[0]?.details.line2).toBeNull();
  });

  it('주소가 없는 고객도 복원된다', () => {
    const customer = toCustomerDomain({ ...row, addresses: [] });
    expect(customer.addressBook.all).toEqual([]);
  });

  it('깨진 고객 UUID를 만나면 CorruptedRecordError를 던진다 — DomainError가 아니다', () => {
    // M7. `of`를 쓰면 InvalidIdError(400)가 나가서, 우리 DB가 깨진 상황에
    // "당신의 요청이 잘못됐다"고 답하게 된다.
    expect(() => toCustomerDomain({ ...row, id: 'broken' })).toThrow(CorruptedRecordError);
  });

  it('깨진 계정 UUID를 만나면 CorruptedRecordError를 던진다', () => {
    expect(() => toCustomerDomain({ ...row, accountId: 'broken' })).toThrow(CorruptedRecordError);
  });

  it('깨진 주소 UUID를 만나면 CorruptedRecordError를 던진다', () => {
    expect(() =>
      toCustomerDomain({ ...row, addresses: [{ ...addressRow, id: 'broken' }] }),
    ).toThrow(CorruptedRecordError);
  });

  it('애그리거트를 주소 행 목록으로 되돌린다', () => {
    const customer = Customer.register({
      id: CustomerId.of(CUSTOMER_ID),
      accountId: AccountId.of(ACCOUNT_ID),
      now: CREATED,
    });
    customer.addAddress(
      AddressId.of(ADDRESS_ID),
      AddressDetails.of({
        label: '집',
        recipient: '홍길동',
        phone: '010-1234-5678',
        zip: '06236',
        line1: '서울시 강남구 테헤란로 1',
        line2: '101동',
      }),
    );

    expect(toSavedAddressRows(customer)).toEqual([addressRow]);
  });

  it('왕복해도 주소 값이 보존된다', () => {
    expect(toSavedAddressRows(toCustomerDomain(row))).toEqual([addressRow]);
  });
});
