import { InvalidAddressError } from './customer.errors';

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
