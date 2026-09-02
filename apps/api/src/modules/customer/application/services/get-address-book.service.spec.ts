import { describe, expect, it } from 'vitest';
import { AccountId, AddressId, CustomerId } from '../../../../shared/kernel/identifiers';
import { AddressDetails } from '../../domain/address-details';
import { Customer } from '../../domain/customer';
import { FIXED_NOW, HOME_ADDRESS, OFFICE_ADDRESS } from '../../testing/customer.fixtures';
import { InMemoryAddressQuery } from '../../testing/in-memory-address.query';
import { InMemoryCustomerRepository } from '../../testing/in-memory-customer.repository';
import { GetAddressBookService } from './get-address-book.service';

function build() {
  const customers = new InMemoryCustomerRepository();
  const addresses = new InMemoryAddressQuery(customers);
  const service = new GetAddressBookService(addresses);
  return { service, customers, addresses };
}

const CUSTOMER_ID = CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dc05e0001');
const ACCOUNT_ID = AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dacc00001');

describe('GetAddressBookService', () => {
  it('주소 목록을 돌려주고 기본 배송지가 맨 앞이다', async () => {
    const { service, customers } = build();
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: FIXED_NOW });
    customer.addAddress(
      AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd10001'),
      AddressDetails.of(HOME_ADDRESS),
    );
    const secondId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd10002');
    customer.addAddress(secondId, AddressDetails.of(OFFICE_ADDRESS));
    customer.setDefaultAddress(secondId);
    await customers.save(customer);

    const views = await service.execute({ customerId: CUSTOMER_ID });

    expect(views).toHaveLength(2);
    expect(views[0]?.id).toBe(secondId);
    expect(views[0]?.isDefault).toBe(true);
  });

  it('주소가 없으면 빈 배열이다', async () => {
    const { service, customers } = build();
    const customer = Customer.register({ id: CUSTOMER_ID, accountId: ACCOUNT_ID, now: FIXED_NOW });
    await customers.save(customer);

    const views = await service.execute({ customerId: CUSTOMER_ID });

    expect(views).toEqual([]);
  });
});
