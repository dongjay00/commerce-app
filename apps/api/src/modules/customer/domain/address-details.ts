import { CorruptedAddressError, InvalidAddressError } from './customer.errors';

export interface AddressDetailsInput {
  readonly label: string;
  readonly recipient: string;
  readonly phone: string;
  readonly zip: string;
  readonly line1: string;
  readonly line2?: string | null;
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidAddressError(field);
  }
  return trimmed;
}

/** 영속 복원 전용. 빈 값은 사용자 입력 오류가 아니라 데이터 무결성 결함(500)이다. */
function requiredFromPersistence(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CorruptedAddressError(field);
  }
  return trimmed;
}

/**
 * 주소 상세 VO. **id가 없다** — 같은 내용의 주소 둘은 같은 값이다.
 *
 * 주문의 `ShippingAddress`(계획 4)는 이 타입을 재사용하지 않고 자기 것을 따로 갖는다.
 * 스펙 §5.3의 스냅샷 규칙: 경계를 넘을 때는 값만 복사하고 모델은 넘기지 않는다.
 */
export class AddressDetails {
  private constructor(
    readonly label: string,
    readonly recipient: string,
    readonly phone: string,
    readonly zip: string,
    readonly line1: string,
    readonly line2: string | null,
  ) {}

  /** 인바운드 전용. 실패는 사용자 입력 오류(400). */
  static of(input: AddressDetailsInput): AddressDetails {
    const line2 = input.line2?.trim() ?? '';
    return new AddressDetails(
      required(input.label, '라벨'),
      required(input.recipient, '수취인'),
      required(input.phone, '연락처'),
      required(input.zip, '우편번호'),
      required(input.line1, '주소'),
      // ''와 null이 섞이면 "같은 주소인가" 비교가 조용히 어긋난다. 하나로 모은다.
      line2.length === 0 ? null : line2,
    );
  }

  /**
   * 영속 복원 전용. 실패는 데이터 무결성 결함(500) — `saved_addresses`의 각 컬럼은
   * `NOT NULL`이지만 빈 문자열까지 막지는 않으므로, 관리자 수정이나 데이터 이관으로
   * 빈 칸이 저장될 수 있다. `identifiers.ts`의 `fromPersistence` / `of` 분리와 같은
   * 이유로 갈라놓는다(M7).
   */
  static fromPersistence(input: AddressDetailsInput): AddressDetails {
    const line2 = input.line2?.trim() ?? '';
    return new AddressDetails(
      requiredFromPersistence(input.label, '라벨'),
      requiredFromPersistence(input.recipient, '수취인'),
      requiredFromPersistence(input.phone, '연락처'),
      requiredFromPersistence(input.zip, '우편번호'),
      requiredFromPersistence(input.line1, '주소'),
      line2.length === 0 ? null : line2,
    );
  }

  equals(other: AddressDetails): boolean {
    return (
      this.label === other.label &&
      this.recipient === other.recipient &&
      this.phone === other.phone &&
      this.zip === other.zip &&
      this.line1 === other.line1 &&
      this.line2 === other.line2
    );
  }
}
