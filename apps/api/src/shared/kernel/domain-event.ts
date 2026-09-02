/**
 * 도메인 이벤트. outbox 테이블의 컬럼과 1:1로 대응한다.
 * payload는 JSON 직렬화 가능한 값만 담는다 (bigint는 문자열로 변환할 것).
 */
export interface DomainEvent {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}
