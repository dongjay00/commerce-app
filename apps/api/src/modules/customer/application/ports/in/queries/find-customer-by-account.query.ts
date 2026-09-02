import type { AccountId, CustomerId } from '../../../../../../shared/kernel/identifiers';

export interface FindCustomerByAccountCommand {
  readonly accountId: AccountId;
}

/**
 * `provision`(태스크 15의 ProvisionCustomerUseCase)과 갈라놓은 조회 전용 포트.
 * identity의 ACL 어댑터가 트랜잭션 없이 "이 계정에 대응하는 고객이 있는가"를 물을 때
 * 쓴다 — provision을 재사용하면 `tx`가 필수라는 쓰기 쪽 계약을 조회를 위해
 * 느슨하게 만들어야 한다.
 */
export interface FindCustomerByAccountQuery {
  execute(command: FindCustomerByAccountCommand): Promise<CustomerId | null>;
}

export const FIND_CUSTOMER_BY_ACCOUNT_QUERY = Symbol('FindCustomerByAccountQuery');
