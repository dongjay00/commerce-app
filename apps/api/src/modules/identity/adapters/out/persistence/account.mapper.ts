import { AccountId } from '../../../../../shared/kernel/identifiers';
import { Account } from '../../../domain/account';
import { Credential } from '../../../domain/credential';
import { Email } from '../../../domain/email';

export interface AccountRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 저장된 행 → 애그리거트.
 *
 * `AccountId.fromPersistence`와 `Email.fromPersistence`를 쓴다. `of`를 쓰면 깨진 행을
 * 만났을 때 `InvalidIdError`/`InvalidEmailError`(둘 다 400)가 나가고, 클라이언트는
 * 자기 요청이 잘못됐다고 듣는다. 실제로는 우리 데이터가 깨진 것이므로 500이어야
 * 한다 (M7). `Credential.fromHash`는 그대로 둔다 — 이미 `DomainError`가 아니라
 * `InvalidCredentialError`(plain `Error`)를 던지므로 M7을 어기지 않는다.
 */
export function toAccountDomain(row: AccountRow): Account {
  return Account.rehydrate({
    id: AccountId.fromPersistence(row.id),
    email: Email.fromPersistence(row.email),
    credential: Credential.fromHash(row.passwordHash),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toAccountRow(account: Account): AccountRow {
  return {
    id: account.id,
    email: account.email.value,
    passwordHash: account.credential.hash,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
