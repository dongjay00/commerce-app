import type { AddressId, CustomerId } from '../../../shared/kernel/identifiers';
import type { CustomerAddressProvider } from '../application/ports/out/customer-address.provider';
import type { ShippingAddress } from '../domain/order/shipping-address';

export class FakeCustomerAddressProvider implements CustomerAddressProvider {
  private readonly byKey = new Map<string, ShippingAddress>();

  put(customerId: CustomerId, addressId: AddressId, address: ShippingAddress): this {
    this.byKey.set(`${customerId}:${addressId}`, address);
    return this;
  }

  async findAddress(customerId: CustomerId, addressId: AddressId): Promise<ShippingAddress | null> {
    return this.byKey.get(`${customerId}:${addressId}`) ?? null;
  }
}
