import type { AddressId } from '../../../shared/kernel/identifiers';
import type { AddressDetails } from './address-details';

/**
 * 주소록 항목. **엔티티다** — 내용이 같아도 ID가 다르면 다른 주소다(집 주소를 두 개
 * 등록해 라벨만 다르게 쓰는 경우가 실제로 있다).
 *
 * 상태를 바꾸는 메서드는 `AddressBook`만 부른다. `Customer` 애그리거트 밖에서는
 * 읽기만 한다 — 밖에서 `markDefault()`를 부를 수 있으면 "기본은 0 또는 1개"
 * 불변식을 지킬 주인이 없어진다.
 */
export class SavedAddress {
  constructor(
    readonly id: AddressId,
    private detailsValue: AddressDetails,
    private defaultFlag: boolean,
  ) {}

  get details(): AddressDetails {
    return this.detailsValue;
  }

  get isDefault(): boolean {
    return this.defaultFlag;
  }

  /** @internal AddressBook 전용 */
  changeDetails(next: AddressDetails): void {
    this.detailsValue = next;
  }

  /** @internal AddressBook 전용 */
  setDefaultFlag(value: boolean): void {
    this.defaultFlag = value;
  }
}
