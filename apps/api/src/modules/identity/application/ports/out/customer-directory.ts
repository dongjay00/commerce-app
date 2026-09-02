import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';

/**
 * Customer 컨텍스트로 나가는 ACL 포트 (스펙 §4.2).
 *
 * identity는 `Customer` 애그리거트가 어떻게 생겼는지 모른다. 아는 것은 "계정 하나에
 * 고객 하나가 대응한다"는 사실과 그 고객의 ID뿐이다. 이 포트의 반환 타입에 도메인
 * 객체가 없는 것이 그 경계다.
 *
 * `provision`이 `tx`를 **필수로** 받는 이유: 계정과 고객은 같은 트랜잭션에서
 * 만들어져야 한다. 갈라지면 계정은 있는데 고객이 없는 사용자가 생기고, 그 사용자는
 * 주소를 하나도 추가할 수 없으면서 로그인은 되는 상태에 갇힌다.
 */
export interface CustomerDirectory {
  provision(accountId: AccountId, tx: TransactionContext): Promise<CustomerId>;
  findByAccount(accountId: AccountId): Promise<CustomerId | null>;
}

export const CUSTOMER_DIRECTORY = Symbol('CustomerDirectory');
