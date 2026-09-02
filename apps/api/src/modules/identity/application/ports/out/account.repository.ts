import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Account } from '../../../domain/account';
import type { Email } from '../../../domain/email';

/**
 * 쓰기 전용 포트 — 애그리거트를 반환한다 (스펙 §7.2).
 *
 * `tx`가 optional인 것은 의도적이다. 트랜잭션 밖에서 단순 조회를 하는 경로(가드,
 * 조회 유스케이스)가 있고, 그때마다 트랜잭션을 여는 것은 비용이다. 쓰기는 항상
 * 유스케이스가 연 트랜잭션 안에서 일어난다.
 *
 * `save`는 삽입과 갱신을 모두 처리한다(upsert). 애그리거트를 다루는 코드가
 * "이게 새 것인가"를 추적하지 않아도 되게 하기 위해서다.
 *
 * **구현체는 이메일 unique 위반을 `EmailAlreadyRegisteredError`로 번역해야 한다.**
 * 유스케이스의 사전 조회만으로는 동시 가입을 막을 수 없다.
 */
export interface AccountRepository {
  findById(id: AccountId, tx?: TransactionContext): Promise<Account | null>;
  findByEmail(email: Email, tx?: TransactionContext): Promise<Account | null>;
  save(account: Account, tx?: TransactionContext): Promise<void>;
}

export const ACCOUNT_REPOSITORY = Symbol('AccountRepository');
