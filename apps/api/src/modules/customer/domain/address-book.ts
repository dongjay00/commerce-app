import type { AddressId } from '../../../shared/kernel/identifiers';
import type { AddressDetails } from './address-details';
import { AddressNotFoundError, CorruptedAddressBookError } from './customer.errors';
import { SavedAddress } from './saved-address';

/**
 * 주소록. `Customer` 애그리거트 **안**의 내부 엔티티다.
 *
 * 불변식: **기본 배송지는 0개 또는 1개.** 이 규칙을 여기 두는 이유는, 규칙을 지키려면
 * 목록 전체를 봐야 하기 때문이다 — `SavedAddress` 하나만으로는 "다른 것이 이미 기본인가"를
 * 알 수 없다. 애그리거트 경계가 여기 그어지는 이유가 정확히 그것이다.
 *
 * DB의 부분 유니크 인덱스가 같은 규칙을 한 번 더 강제한다. 도메인만으로는 두 요청이
 * 동시에 서로 다른 주소를 기본으로 지정하는 경합을 막을 수 없다.
 */
export class AddressBook {
  private constructor(private readonly items: SavedAddress[]) {}

  static empty(): AddressBook {
    return new AddressBook([]);
  }

  static rehydrate(customerId: string, items: SavedAddress[]): AddressBook {
    const defaults = items.filter((item) => item.isDefault).length;
    if (defaults > 1) {
      throw new CorruptedAddressBookError(customerId, defaults);
    }
    return new AddressBook([...items]);
  }

  /** 기본 배송지가 맨 앞에 온다. 화면이 정렬을 다시 하지 않아도 되게 한다. */
  get all(): readonly SavedAddress[] {
    return [...this.items].sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
  }

  get defaultAddress(): SavedAddress | null {
    return this.items.find((item) => item.isDefault) ?? null;
  }

  add(id: AddressId, details: AddressDetails): SavedAddress {
    // 첫 주소는 자동으로 기본이 된다. 주소가 하나뿐인데 기본이 없으면 주문 화면의
    // 배송지 선택 단계가 무의미해진다.
    const address = new SavedAddress(id, details, this.items.length === 0);
    this.items.push(address);
    return address;
  }

  update(id: AddressId, details: AddressDetails): SavedAddress {
    const current = this.require(id);
    const updated = current.withDetails(details);
    this.items[this.items.indexOf(current)] = updated;
    return updated;
  }

  remove(id: AddressId): void {
    const current = this.require(id);
    // 남은 주소 중 하나를 자동 승격시키지 않는다. 어디로 배송할지는 사용자의 결정이고,
    // 시스템이 임의로 고르면 다음 주문이 엉뚱한 곳으로 간다.
    this.items.splice(this.items.indexOf(current), 1);
  }

  setDefault(id: AddressId): void {
    // 찾기를 먼저 한다. 없는 ID로 호출했을 때 기존 기본이 이미 해제된 상태가 되면 안 된다.
    const target = this.require(id);
    this.items.forEach((item, index) => {
      this.items[index] = item.withDefault(item === target);
    });
  }

  private require(id: AddressId): SavedAddress {
    const found = this.items.find((item) => item.id === id);
    if (found === undefined) {
      throw new AddressNotFoundError(id);
    }
    return found;
  }
}
