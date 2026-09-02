import type { AddressId } from '../../../shared/kernel/identifiers';
import type { AddressDetails } from './address-details';

/**
 * 주소록 항목. **엔티티다** — 내용이 같아도 ID가 다르면 다른 주소다(집 주소를 두 개
 * 등록해 라벨만 다르게 쓰는 경우가 실제로 있다).
 *
 * **불변이다.** 상태를 바꾸는 공개 메서드가 없다 — `withDetails`/`withDefault`는
 * 새 인스턴스를 반환할 뿐 자신을 바꾸지 않는다. `AddressBook.all`/`defaultAddress`가
 * 내부 배열의 인스턴스를 그대로 돌려주므로, 뮤테이터가 있었다면 그걸 손에 쥔 어떤
 * 호출자든 `AddressBook`을 거치지 않고 "기본은 0 또는 1개" 불변식을 깰 수 있었다.
 * 바뀐 상태는 `AddressBook`이 새 인스턴스를 `items`에 반영해야만 존재한다 — 이제
 * 이것이 컨벤션이 아니라 타입 시스템이 강제하는 사실이다.
 */
export class SavedAddress {
  constructor(
    readonly id: AddressId,
    private readonly detailsValue: AddressDetails,
    private readonly defaultFlag: boolean,
  ) {}

  get details(): AddressDetails {
    return this.detailsValue;
  }

  get isDefault(): boolean {
    return this.defaultFlag;
  }

  /** 내용만 바뀐 새 인스턴스를 만든다. `this`는 바뀌지 않는다. */
  withDetails(next: AddressDetails): SavedAddress {
    return new SavedAddress(this.id, next, this.defaultFlag);
  }

  /** 기본 여부만 바뀐 새 인스턴스를 만든다. `this`는 바뀌지 않는다. */
  withDefault(value: boolean): SavedAddress {
    return new SavedAddress(this.id, this.detailsValue, value);
  }
}
