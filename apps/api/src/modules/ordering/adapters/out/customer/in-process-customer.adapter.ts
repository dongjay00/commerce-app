import { Inject, Injectable } from '@nestjs/common';
import type { AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import { GET_ADDRESS_BOOK_QUERY, type GetAddressBookQuery } from '../../../../customer';
import type { CustomerAddressProvider } from '../../../application/ports/out/customer-address.provider';
import { ShippingAddress } from '../../../domain/order/shipping-address';

/**
 * Customer로 나가는 ACL. `SavedAddress`(id를 가진 엔티티)를 `ShippingAddress`(id 없는
 * VO)로 바꾼다(스펙 §5.3).
 *
 * 주소록 전체를 받아 메모리에서 고른다. 전용 조회 포트를 만들지 않는 이유: 주소록은
 * 고객당 수 개이고, 호출자가 하나뿐이며 테스트에서 바꿔치기할 이유도 없는 포트는
 * 포트가 아니다(스펙 §7.7).
 *
 * `customerId`로 범위가 좁혀지므로 **남의 주소를 넘기면 `null`이다** — 인가가 조회에
 * 내장된다.
 */
@Injectable()
export class InProcessCustomerAdapter implements CustomerAddressProvider {
  constructor(@Inject(GET_ADDRESS_BOOK_QUERY) private readonly addressBook: GetAddressBookQuery) {}

  async findAddress(customerId: CustomerId, addressId: AddressId): Promise<ShippingAddress | null> {
    const addresses = await this.addressBook.execute({ customerId });
    const found = addresses.find((address) => address.id === addressId);
    if (found === undefined) {
      return null;
    }
    // label을 담지 않는다 — 주소록에서 고르기 위한 메타데이터이지 배송 정보가 아니다.
    return ShippingAddress.fromPersistence({
      recipient: found.recipient,
      phone: found.phone,
      zip: found.zip,
      line1: found.line1,
      line2: found.line2,
    });
  }
}
