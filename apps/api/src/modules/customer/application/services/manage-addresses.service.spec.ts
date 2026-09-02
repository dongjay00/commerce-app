import { describe, expect, it } from 'vitest';
import { AccountId, AddressId, CustomerId } from '../../../../shared/kernel/identifiers';
import { PassthroughTransactionManager } from '../../../../shared/testing/passthrough-transaction-manager';
import { SequentialIdGenerator } from '../../../../shared/testing/sequential-id-generator';
import { Customer } from '../../domain/customer';
import { AddressNotFoundError, InvalidAddressError } from '../../domain/customer.errors';
import { FIXED_NOW, HOME_ADDRESS, OFFICE_ADDRESS } from '../../testing/customer.fixtures';
import { InMemoryCustomerRepository } from '../../testing/in-memory-customer.repository';
import { CustomerNotFoundError, ManageAddressesService } from './manage-addresses.service';

function build() {
  const customers = new InMemoryCustomerRepository();
  const transactions = new PassthroughTransactionManager();
  const ids = new SequentialIdGenerator();

  const service = new ManageAddressesService(customers, transactions, ids);

  return { service, customers, transactions, ids };
}

async function aSavedCustomer(customers: InMemoryCustomerRepository, suffix = '0001') {
  const customer = Customer.register({
    id: CustomerId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dc05e${suffix}`),
    accountId: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dacc0${suffix}`),
    now: FIXED_NOW,
  });
  await customers.save(customer);
  return customer.id;
}

const MISSING_CUSTOMER_ID = CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dc05e9999');

describe('ManageAddressesService', () => {
  it('주소를 추가하고 AddressView를 돌려준다 — 첫 주소는 isDefault: true', async () => {
    const { service, customers } = build();
    const customerId = await aSavedCustomer(customers);

    const view = await service.add({ customerId, details: HOME_ADDRESS });

    expect(view.label).toBe(HOME_ADDRESS.label);
    expect(view.recipient).toBe(HOME_ADDRESS.recipient);
    expect(view.isDefault).toBe(true);
  });

  it('두 번째 주소는 isDefault: false', async () => {
    const { service, customers } = build();
    const customerId = await aSavedCustomer(customers);

    await service.add({ customerId, details: HOME_ADDRESS });
    const second = await service.add({ customerId, details: OFFICE_ADDRESS });

    expect(second.isDefault).toBe(false);
  });

  it('수정이 내용을 바꾸고 기본 여부는 유지한다', async () => {
    const { service, customers } = build();
    const customerId = await aSavedCustomer(customers);
    const added = await service.add({ customerId, details: HOME_ADDRESS });

    const updated = await service.update({
      customerId,
      addressId: AddressId.of(added.id),
      details: OFFICE_ADDRESS,
    });

    expect(updated.label).toBe(OFFICE_ADDRESS.label);
    expect(updated.isDefault).toBe(true);
  });

  it('삭제 후 조회하면 없다', async () => {
    const { service, customers } = build();
    const customerId = await aSavedCustomer(customers);
    const added = await service.add({ customerId, details: HOME_ADDRESS });

    await service.remove({ customerId, addressId: AddressId.of(added.id) });

    const stored = await customers.findById(customerId);
    expect(stored?.addressBook.all).toHaveLength(0);
  });

  it('기본 지정이 이전 기본을 해제한다 — 저장본에서 확인한다', async () => {
    const { service, customers } = build();
    const customerId = await aSavedCustomer(customers);
    const first = await service.add({ customerId, details: HOME_ADDRESS });
    const second = await service.add({ customerId, details: OFFICE_ADDRESS });

    await service.setDefault({ customerId, addressId: AddressId.of(second.id) });

    // 메모리에 들고 있는 응답 값이 아니라 리포지토리를 다시 읽어서 확인한다.
    const stored = await customers.findById(customerId);
    const firstStored = stored?.addressBook.all.find((a) => a.id === AddressId.of(first.id));
    const secondStored = stored?.addressBook.all.find((a) => a.id === AddressId.of(second.id));
    expect(firstStored?.isDefault).toBe(false);
    expect(secondStored?.isDefault).toBe(true);
  });

  it('다른 고객의 주소 ID로 수정하면 AddressNotFoundError다', async () => {
    const { service, customers } = build();
    const customerId = await aSavedCustomer(customers, '0001');
    const otherCustomerId = await aSavedCustomer(customers, '0002');
    const addedForOther = await service.add({ customerId: otherCustomerId, details: HOME_ADDRESS });

    await expect(
      service.update({
        customerId,
        addressId: AddressId.of(addedForOther.id),
        details: OFFICE_ADDRESS,
      }),
    ).rejects.toThrow(AddressNotFoundError);
  });

  it('없는 고객 ID면 CustomerNotFoundError다', async () => {
    const { service } = build();

    await expect(
      service.add({ customerId: MISSING_CUSTOMER_ID, details: HOME_ADDRESS }),
    ).rejects.toThrow(CustomerNotFoundError);
  });

  it('빈 수취인으로 추가하면 InvalidAddressError이고 고객은 저장되지 않는다', async () => {
    const { service, customers } = build();
    const customerId = await aSavedCustomer(customers);

    await expect(
      service.add({ customerId, details: { ...HOME_ADDRESS, recipient: '   ' } }),
    ).rejects.toThrow(InvalidAddressError);

    const stored = await customers.findById(customerId);
    expect(stored?.addressBook.all).toHaveLength(0);
  });
});
