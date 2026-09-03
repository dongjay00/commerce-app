import { describe, expect, it } from 'vitest';
import { AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { AddressView, GetAddressBookQuery } from '../../../../customer';
import { addressUuid, customerUuid } from '../../../testing/ordering.fixtures';
import { InProcessCustomerAdapter } from './in-process-customer.adapter';

class FakeAddressBook implements GetAddressBookQuery {
  constructor(private readonly views: AddressView[]) {}

  async execute(): Promise<AddressView[]> {
    return this.views;
  }
}

const OWNER = CustomerId.of(customerUuid('1'));

const view = (suffix: string, line2: string | null = '3층'): AddressView => ({
  id: addressUuid(suffix),
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2,
  isDefault: true,
});

describe('InProcessCustomerAdapter', () => {
  it('id로 주소를 고른다', async () => {
    const adapter = new InProcessCustomerAdapter(new FakeAddressBook([view('1'), view('2')]));

    const found = await adapter.findAddress(OWNER, AddressId.of(addressUuid('2')));

    expect(found?.recipient).toBe('홍길동');
    expect(found?.line2).toBe('3층');
  });

  it('없는 id면 null이다', async () => {
    const adapter = new InProcessCustomerAdapter(new FakeAddressBook([view('1')]));
    expect(await adapter.findAddress(OWNER, AddressId.of(addressUuid('9')))).toBeNull();
  });

  it('line2가 null이면 그대로 null이다', async () => {
    const adapter = new InProcessCustomerAdapter(new FakeAddressBook([view('1', null)]));

    const found = await adapter.findAddress(OWNER, AddressId.of(addressUuid('1')));

    expect(found?.line2).toBeNull();
  });

  it('label은 ShippingAddress에 담기지 않는다', async () => {
    // 주소록에서 고르기 위한 메타데이터이지 배송에 필요한 정보가 아니다(스펙 §5.3).
    const adapter = new InProcessCustomerAdapter(new FakeAddressBook([view('1')]));

    const found = await adapter.findAddress(OWNER, AddressId.of(addressUuid('1')));

    expect(found).not.toHaveProperty('label');
  });
});
