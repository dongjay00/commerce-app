import { describe, expect, it } from 'vitest';
import { AddressId } from '../../../shared/kernel/identifiers';
import { AddressBook } from './address-book';
import { AddressDetails } from './address-details';
import { AddressNotFoundError, CorruptedAddressBookError } from './customer.errors';
import { SavedAddress } from './saved-address';

const ID_A = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daaaa0001');
const ID_B = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daaaa0002');
const ID_C = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daaaa0003');
const MISSING = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daaaa9999');

function details(label: string): AddressDetails {
  return AddressDetails.of({
    label,
    recipient: '홍길동',
    phone: '010-1234-5678',
    zip: '06236',
    line1: '서울시 강남구 테헤란로 1',
  });
}

describe('AddressBook.add', () => {
  it('첫 주소는 자동으로 기본 배송지가 된다', () => {
    // 주소가 하나뿐인데 기본이 없으면 주문 화면에서 배송지를 고르는 단계가 무의미해진다.
    const book = AddressBook.empty();
    const added = book.add(ID_A, details('집'));
    expect(added.isDefault).toBe(true);
    expect(book.defaultAddress?.id).toBe(ID_A);
  });

  it('두 번째 주소는 기본이 되지 않는다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    const second = book.add(ID_B, details('회사'));
    expect(second.isDefault).toBe(false);
    expect(book.defaultAddress?.id).toBe(ID_A);
  });

  it('기본 배송지가 목록의 맨 앞에 온다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.add(ID_B, details('회사'));
    book.setDefault(ID_B);
    expect(book.all.map((a) => a.id)).toEqual([ID_B, ID_A]);
  });
});

describe('AddressBook.setDefault', () => {
  it('이전 기본을 해제하고 새 기본을 세운다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.add(ID_B, details('회사'));

    book.setDefault(ID_B);

    expect(book.all.filter((a) => a.isDefault)).toHaveLength(1);
    expect(book.defaultAddress?.id).toBe(ID_B);
  });

  it('이미 기본인 주소를 다시 지정해도 기본이 하나다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.setDefault(ID_A);
    expect(book.all.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('없는 ID면 AddressNotFoundError다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    expect(() => book.setDefault(MISSING)).toThrow(AddressNotFoundError);
  });

  it('실패해도 기존 기본이 유지된다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    expect(() => book.setDefault(MISSING)).toThrow();
    expect(book.defaultAddress?.id).toBe(ID_A);
  });
});

describe('AddressBook.update', () => {
  it('내용을 바꾸되 기본 여부는 유지한다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    const updated = book.update(ID_A, details('본가'));
    expect(updated.details.label).toBe('본가');
    expect(updated.isDefault).toBe(true);
  });

  it('없는 ID면 AddressNotFoundError다', () => {
    expect(() => AddressBook.empty().update(MISSING, details('집'))).toThrow(AddressNotFoundError);
  });
});

describe('AddressBook.remove', () => {
  it('주소를 지운다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.add(ID_B, details('회사'));
    book.remove(ID_B);
    expect(book.all.map((a) => a.id)).toEqual([ID_A]);
  });

  it('기본 배송지를 지우면 기본이 없어진다', () => {
    // 남은 주소 중 하나를 자동 승격시키지 않는다. "어느 것을 골랐는지"는 사용자의
    // 결정이고, 시스템이 임의로 고르면 다음 주문이 엉뚱한 곳으로 간다.
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.add(ID_B, details('회사'));
    book.remove(ID_A);
    expect(book.defaultAddress).toBeNull();
    expect(book.all).toHaveLength(1);
  });

  it('마지막 주소를 지우면 빈 주소록이 된다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.remove(ID_A);
    expect(book.all).toEqual([]);
    expect(book.defaultAddress).toBeNull();
  });

  it('지운 뒤 새로 넣은 주소는 다시 자동 기본이 된다', () => {
    const book = AddressBook.empty();
    book.add(ID_A, details('집'));
    book.remove(ID_A);
    expect(book.add(ID_B, details('회사')).isDefault).toBe(true);
  });

  it('없는 ID면 AddressNotFoundError다', () => {
    expect(() => AddressBook.empty().remove(MISSING)).toThrow(AddressNotFoundError);
  });
});

describe('AddressBook.rehydrate', () => {
  it('저장된 항목을 복원한다', () => {
    const book = AddressBook.rehydrate('cust-1', [
      new SavedAddress(ID_A, details('집'), false),
      new SavedAddress(ID_B, details('회사'), true),
    ]);
    expect(book.defaultAddress?.id).toBe(ID_B);
    expect(book.all).toHaveLength(2);
  });

  it('기본이 둘 이상이면 CorruptedAddressBookError다', () => {
    // 부분 유니크 인덱스가 막고 있으므로 정상 경로로는 불가능하다. 인덱스가 사라졌을 때
    // 조용히 굴러가지 않게 한다.
    expect(() =>
      AddressBook.rehydrate('cust-1', [
        new SavedAddress(ID_A, details('집'), true),
        new SavedAddress(ID_B, details('회사'), true),
      ]),
    ).toThrow(CorruptedAddressBookError);
  });

  it('기본이 없는 주소록도 유효하다', () => {
    const book = AddressBook.rehydrate('cust-1', [new SavedAddress(ID_C, details('집'), false)]);
    expect(book.defaultAddress).toBeNull();
  });

  it('빈 주소록도 유효하다', () => {
    expect(AddressBook.rehydrate('cust-1', []).all).toEqual([]);
  });
});
