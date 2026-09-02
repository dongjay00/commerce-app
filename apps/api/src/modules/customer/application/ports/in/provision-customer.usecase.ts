import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';

export interface ProvisionCustomerCommand {
  readonly accountId: AccountId;
  /**
   * 호출자(identity의 가입 유스케이스)가 연 트랜잭션. 필수다 — 계정과 고객이 갈라져
   * 커밋되면 로그인은 되는데 주소를 하나도 추가할 수 없는 사용자가 생긴다.
   */
  readonly tx: TransactionContext;
}

/** 멱등하다. 이미 고객이 있으면 그 ID를 돌려준다. */
export interface ProvisionCustomerUseCase {
  execute(command: ProvisionCustomerCommand): Promise<CustomerId>;
}

export const PROVISION_CUSTOMER_USECASE = Symbol('ProvisionCustomerUseCase');
