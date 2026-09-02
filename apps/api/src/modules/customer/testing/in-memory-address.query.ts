import type { CustomerId } from '../../../shared/kernel/identifiers';
import type { AddressQuery, AddressView } from '../application/ports/out/address.query';
import type { CustomerRepository } from '../application/ports/out/customer.repository';

/**
 * 단위 테스트용 AddressQuery. 리포지토리를 감싸 애그리거트를 읽기 모델로 옮긴다.
 * 실물 Prisma 어댑터는 애그리거트를 재구성하지 않고 직접 projection하지만(스펙
 * §7.2), fake는 이미 있는 `CustomerRepository`를 재사용하는 편이 간단하다.
 */
export class InMemoryAddressQuery implements AddressQuery {
  constructor(private readonly customers: CustomerRepository) {}

  async listByCustomer(customerId: CustomerId): Promise<AddressView[]> {
    const customer = await this.customers.findById(customerId);
    if (customer === null) {
      return [];
    }
    return customer.addressBook.all.map((address) => ({
      id: address.id,
      label: address.details.label,
      recipient: address.details.recipient,
      phone: address.details.phone,
      zip: address.details.zip,
      line1: address.details.line1,
      line2: address.details.line2,
      isDefault: address.isDefault,
    }));
  }
}
