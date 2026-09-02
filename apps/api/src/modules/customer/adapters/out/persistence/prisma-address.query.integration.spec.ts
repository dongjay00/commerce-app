import { describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { AccountId, AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import { AddressDetails } from '../../../domain/address-details';
import { Customer } from '../../../domain/customer';
import { PrismaAddressQuery } from './prisma-address.query';
import { PrismaCustomerRepository } from './prisma-customer.repository';

// 조회 전용 어댑터라 CustomerRepository와는 별개의 계약이 없다. 여기서는
// PrismaCustomerRepository로 데이터를 저장해두고 PrismaAddressQuery로 읽어,
// 애그리거트를 거치지 않는 projection이 실제 저장된 값과 일치하는지 확인한다.
// 파일 간 정리는 integration-setup.ts의 TRUNCATE가 한다.

const NOW = new Date('2026-03-01T10:00:00.000Z');

function aCustomer(suffix: string): Customer {
  return Customer.register({
    id: CustomerId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dc05e${suffix}`),
    accountId: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dacc0${suffix}`),
    now: NOW,
  });
}

function details(label: string, line2: string | null = null): AddressDetails {
  return AddressDetails.of({
    label,
    recipient: '홍길동',
    phone: '010-1234-5678',
    zip: '06236',
    line1: '서울시 강남구 테헤란로 1',
    line2,
  });
}

describe('PrismaAddressQuery', () => {
  it('고객의 주소를 모두 돌려준다', async () => {
    const db = await testDb();
    const repo = new PrismaCustomerRepository(db);
    const query = new PrismaAddressQuery(db);

    const customer = aCustomer('a001');
    customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd70001'), details('집'));
    customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd70002'), details('회사'));
    await repo.save(customer);

    const views = await query.listByCustomer(customer.id);
    expect(views).toHaveLength(2);
  });

  it('기본 배송지가 맨 앞에 온다', async () => {
    const db = await testDb();
    const repo = new PrismaCustomerRepository(db);
    const query = new PrismaAddressQuery(db);

    const customer = aCustomer('a002');
    const first = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd70003');
    const second = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd70004');
    // 알파벳/가나다 순으로는 뒤에 오는 라벨을 기본으로 지정해, 정렬이 라벨이 아니라
    // isDefault를 먼저 본다는 것을 확인한다.
    customer.addAddress(first, details('가'));
    customer.addAddress(second, details('나'));
    customer.setDefaultAddress(second);
    await repo.save(customer);

    const views = await query.listByCustomer(customer.id);
    expect(views[0]?.id).toBe(second);
    expect(views[0]?.isDefault).toBe(true);
  });

  it('기본이 아닌 주소들이 라벨 순으로 안정적으로 정렬된다', async () => {
    // 맨 처음 추가한 주소는 자동으로 기본이 된다(AddressBook.add). 나머지 셋을
    // 라벨이 뒤섞인 순서로 추가해, 기본이 아닌 주소들끼리는 라벨 순으로만
    // 정렬되는지 본다.
    const db = await testDb();
    const repo = new PrismaCustomerRepository(db);
    const query = new PrismaAddressQuery(db);

    const customer = aCustomer('a003');
    customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd7000b'), details('기본'));
    customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd7000c'), details('다'));
    customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd7000d'), details('가'));
    customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd7000e'), details('나'));
    await repo.save(customer);

    const first = await query.listByCustomer(customer.id);
    const second = await query.listByCustomer(customer.id);

    expect(first.map((v) => v.label)).toEqual(['기본', '가', '나', '다']);
    expect(second.map((v) => v.label)).toEqual(['기본', '가', '나', '다']);
  });

  it('다른 고객의 주소는 섞이지 않는다', async () => {
    const db = await testDb();
    const repo = new PrismaCustomerRepository(db);
    const query = new PrismaAddressQuery(db);

    const customerA = aCustomer('a004');
    customerA.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd70008'), details('집'));
    await repo.save(customerA);

    const customerB = aCustomer('a005');
    customerB.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd70009'), details('회사'));
    await repo.save(customerB);

    const views = await query.listByCustomer(customerA.id);
    expect(views).toHaveLength(1);
    expect(views[0]?.id).toBe('018f2b1c-4a5d-7e6f-8a9b-0c1dadd70008');
  });

  it('주소가 없으면 빈 배열', async () => {
    const db = await testDb();
    const repo = new PrismaCustomerRepository(db);
    const query = new PrismaAddressQuery(db);

    const customer = aCustomer('a006');
    await repo.save(customer);

    expect(await query.listByCustomer(customer.id)).toEqual([]);
  });

  it('line2가 null인 행이 null로 나온다', async () => {
    const db = await testDb();
    const repo = new PrismaCustomerRepository(db);
    const query = new PrismaAddressQuery(db);

    const customer = aCustomer('a007');
    const addressId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd7000a');
    customer.addAddress(addressId, details('회사', null));
    await repo.save(customer);

    const views = await query.listByCustomer(customer.id);
    expect(views.find((v) => v.id === addressId)?.line2).toBeNull();
  });
});
