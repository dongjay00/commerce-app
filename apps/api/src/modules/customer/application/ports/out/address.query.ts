import type { CustomerId } from '../../../../../shared/kernel/identifiers';

/**
 * 읽기 전용 모델. 애그리거트를 재구성하지 않고 Prisma가 직접 projection한다 (스펙 §7.2).
 *
 * `@commerce/contracts`의 `AddressDto`를 쓰지 않는 이유는 애플리케이션 계층이 와이어
 * 계약에 묶이지 않기 위해서다. 모양이 같아 컨트롤러의 매핑은 한 줄이고, 계약이
 * 갈라지는 순간 그 한 줄만 바뀐다.
 */
export interface AddressView {
  readonly id: string;
  readonly label: string;
  readonly recipient: string;
  readonly phone: string;
  readonly zip: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly isDefault: boolean;
}

export interface AddressQuery {
  /** 기본 배송지가 맨 앞에 온다. */
  listByCustomer(customerId: CustomerId): Promise<AddressView[]>;
}

export const ADDRESS_QUERY = Symbol('AddressQuery');
