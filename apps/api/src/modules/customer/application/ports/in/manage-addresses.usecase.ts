import type { AddressId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { AddressDetailsInput } from '../../../domain/address-details';
import type { AddressView } from '../out/address.query';

export interface AddAddressCommand {
  readonly customerId: CustomerId;
  readonly details: AddressDetailsInput;
}

export interface UpdateAddressCommand extends AddAddressCommand {
  readonly addressId: AddressId;
}

export interface AddressCommand {
  readonly customerId: CustomerId;
  readonly addressId: AddressId;
}

/**
 * 네 연산을 한 포트에 묶었다. 넷 모두 같은 애그리거트를 불러 한 메서드를 부르고
 * 저장하는 다섯 줄이고 의존성도 완전히 같다 — 인터페이스를 넷으로 쪼개면 Nest
 * 프로바이더·팩토리·주입만 넷씩 늘어난다. 인바운드 어댑터에서는 여전히 네 엔드포인트다.
 */
export interface ManageAddressesUseCase {
  add(command: AddAddressCommand): Promise<AddressView>;
  update(command: UpdateAddressCommand): Promise<AddressView>;
  remove(command: AddressCommand): Promise<void>;
  setDefault(command: AddressCommand): Promise<void>;
}

export const MANAGE_ADDRESSES_USECASE = Symbol('ManageAddressesUseCase');
