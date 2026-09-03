import { CorruptedShippingAddressError, InvalidShippingAddressError } from './order.errors';

interface ShippingAddressParams {
  readonly recipient: string;
  readonly phone: string;
  readonly zip: string;
  readonly line1: string;
  readonly line2: string | null;
}

/**
 * 배송지 스냅샷. **id도 label도 없다** — Customer의 `SavedAddress`와 별개의 VO다(스펙 §5.3).
 *
 * 고객이 이사해서 주소록을 고쳐도 과거 주문의 배송지는 그대로 남는다. `label`("집",
 * "회사")을 담지 않는 이유: 그것은 주소록에서 고르기 위한 메타데이터이지 배송에
 * 필요한 정보가 아니다.
 */
export class ShippingAddress {
  private constructor(
    readonly recipient: string,
    readonly phone: string,
    readonly zip: string,
    readonly line1: string,
    readonly line2: string | null,
  ) {}

  /** 인바운드 전용. 실패는 사용자 입력 오류(400). */
  static of(params: ShippingAddressParams): ShippingAddress {
    return ShippingAddress.build(params, (field) => new InvalidShippingAddressError(field));
  }

  /** 영속 복원 전용. 실패는 데이터 무결성 결함(500). */
  static fromPersistence(params: ShippingAddressParams): ShippingAddress {
    return ShippingAddress.build(params, (field) => new CorruptedShippingAddressError(field));
  }

  private static build(
    params: ShippingAddressParams,
    onEmpty: (field: string) => Error,
  ): ShippingAddress {
    const required = {
      recipient: params.recipient,
      phone: params.phone,
      zip: params.zip,
      line1: params.line1,
    };
    for (const [field, value] of Object.entries(required)) {
      if (value.trim().length === 0) {
        throw onEmpty(field);
      }
    }
    const line2 = params.line2 === null ? null : params.line2.trim();
    return new ShippingAddress(
      params.recipient.trim(),
      params.phone.trim(),
      params.zip.trim(),
      params.line1.trim(),
      line2 === '' ? null : line2,
    );
  }
}
