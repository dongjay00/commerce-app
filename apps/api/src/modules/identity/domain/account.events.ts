import type { DomainEvent } from '../../../shared/kernel/domain-event';
import type { AccountId } from '../../../shared/kernel/identifiers';
import type { Email } from './email';

export const ACCOUNT_REGISTERED = 'identity.AccountRegistered';

/**
 * 계정이 생성됐다. payload에는 **JSON 직렬화 가능한 원시 값만** 담는다 —
 * outbox의 payload 컬럼이 JsonB이고, VO를 그대로 넣으면 직렬화가 `{}`가 되어
 * 조용히 빈 이벤트가 발행된다.
 *
 * 비밀번호 해시는 절대 담지 않는다. outbox 행은 사실상 영구 보존되는 로그다.
 */
export function accountRegistered(
  accountId: AccountId,
  email: Email,
  occurredAt: Date,
): DomainEvent {
  return {
    eventType: ACCOUNT_REGISTERED,
    aggregateType: 'Account',
    aggregateId: accountId,
    occurredAt,
    payload: { accountId, email: email.value },
  };
}
