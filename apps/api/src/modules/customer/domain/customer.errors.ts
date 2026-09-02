import { DomainError } from '../../../shared/kernel/domain-error';

/**
 * 주소 항목이 비어 있다. 어댑터의 Zod도 같은 것을 보지만(스펙 §8.4의 형식 검증),
 * 여기 한 벌 더 있는 이유는 HTTP가 아닌 경로로 들어올 때도 배송 불가능한 주소가
 * 저장되지 않게 하기 위해서다.
 */
export class InvalidAddressError extends DomainError {
  static readonly CODE = 'INVALID_ADDRESS';
  readonly code = InvalidAddressError.CODE;

  constructor(field: string) {
    super(`주소의 ${field}은(는) 비어 있을 수 없습니다.`);
  }
}

/**
 * 주소록에 그 ID가 없다. **다른 고객의 주소 ID를 넣었을 때도 이것이 난다** —
 * 403이 아닌 이유는 "그 ID는 존재하지만 당신 것이 아니다"라는 사실 자체를 흘리지
 * 않기 위해서다.
 */
export class AddressNotFoundError extends DomainError {
  static readonly CODE = 'ADDRESS_NOT_FOUND';
  readonly code = AddressNotFoundError.CODE;

  constructor(addressId: string) {
    super(`주소를 찾을 수 없습니다: ${addressId}`);
  }
}

/**
 * 저장된 주소록이 불변식을 어긴 상태다(기본 배송지가 둘 이상). 부분 유니크 인덱스가
 * 막고 있으므로 정상 경로로는 발생할 수 없다 — 발생했다면 인덱스가 사라졌거나 데이터가
 * 수동으로 손상된 것이다. `DomainError`가 아니므로 500으로 떨어진다.
 */
export class CorruptedAddressBookError extends Error {
  constructor(customerId: string, defaultCount: number) {
    super(`고객 ${customerId}의 기본 배송지가 ${defaultCount}개입니다.`);
    this.name = 'CorruptedAddressBookError';
  }
}
