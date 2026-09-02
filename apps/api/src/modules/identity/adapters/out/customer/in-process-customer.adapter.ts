import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { FindCustomerByAccountQuery, ProvisionCustomerUseCase } from '../../../../customer';
import type { CustomerDirectory } from '../../../application/ports/out/customer-directory';

/**
 * Customer 컨텍스트로 나가는 ACL 어댑터 (스펙 §4.2).
 *
 * `../../../../customer`(= `modules/customer/index.ts`)만 본다 — 내부 파일을 하나라도
 * import하면 `no-cross-module-internals`가 잡는다. 나중에 customer가 별도 서비스로
 * 떨어져 나가면 **이 파일 하나만** HTTP 클라이언트로 바뀐다.
 *
 * `findByAccount`는 `ProvisionCustomerUseCase`를 재사용하지 않고 customer가 별도로
 * 내보내는 조회 전용 포트(`FindCustomerByAccountQuery`)에 위임한다 — `provision`의
 * `tx` 필수 계약("계정과 고객은 같은 트랜잭션에서 만들어져야 한다")을 조회 때문에
 * 느슨하게 만들지 않기 위해서다.
 */
export class InProcessCustomerAdapter implements CustomerDirectory {
  constructor(
    private readonly provisionCustomer: ProvisionCustomerUseCase,
    private readonly findCustomerByAccount: FindCustomerByAccountQuery,
  ) {}

  async provision(accountId: AccountId, tx: TransactionContext): Promise<CustomerId> {
    return this.provisionCustomer.execute({ accountId, tx });
  }

  async findByAccount(accountId: AccountId): Promise<CustomerId | null> {
    return this.findCustomerByAccount.execute({ accountId });
  }
}
