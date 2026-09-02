import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { Session } from '../../../domain/session';

export interface SessionRepository {
  /** 해시로 찾는다. 원본 리프레시 토큰은 저장되지 않으므로 이것이 유일한 조회 경로다. */
  findByRefreshTokenHash(hash: string, tx?: TransactionContext): Promise<Session | null>;
  save(session: Session, tx?: TransactionContext): Promise<void>;
  /**
   * 계정의 살아 있는 세션을 한꺼번에 폐기하고 폐기된 개수를 반환한다.
   * 비밀번호 변경이 이걸 부른다 — 스펙 §10.8이 sessions 테이블을 "즉시 무효화의 근거"라고
   * 적은 이유가 이 메서드다. 이미 폐기된 세션은 세지 않는다.
   */
  revokeAllForAccount(accountId: AccountId, now: Date, tx?: TransactionContext): Promise<number>;
}

export const SESSION_REPOSITORY = Symbol('SessionRepository');
