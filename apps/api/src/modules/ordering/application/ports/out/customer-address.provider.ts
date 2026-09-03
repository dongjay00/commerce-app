import type { AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { ShippingAddress } from '../../../domain/order/shipping-address';

/**
 * Customer로 나가는 ACL. `SavedAddress`(id를 가진 엔티티)를 `ShippingAddress`(id 없는
 * VO)로 바꾼다(스펙 §5.3).
 *
 * **`addressId`를 필수로 받는다.** "기본 배송지를 알아서 쓴다"로 만들면 고객이 어느
 * 주소로 배송되는지 모른 채 주문하게 되고, 테스트도 숨은 기본값에 의존하게 된다.
 * 고객이 주소록에서 고른 것을 명시적으로 넘긴다.
 *
 * 남의 주소를 넘기면 `null`이다 — `customerId`로 범위가 좁혀지므로 인가가 조회에
 * 내장된다.
 */
export interface CustomerAddressProvider {
  findAddress(customerId: CustomerId, addressId: AddressId): Promise<ShippingAddress | null>;
}

export const CUSTOMER_ADDRESS_PROVIDER = Symbol('CustomerAddressProvider');
