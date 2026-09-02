/** outbox 행 하나가 바깥으로 나갈 때의 모양. */
export interface OutboxRecord {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

/**
 * 이벤트가 나가는 출구.
 * 지금은 같은 프로세스의 Nest EventEmitter 어댑터를 꽂지만,
 * 나중에 Kafka 어댑터로 교체해도 릴레이 코드는 바뀌지 않는다.
 */
export interface EventTransport {
  send(record: OutboxRecord): Promise<void>;
}

export const EVENT_TRANSPORT = Symbol('EventTransport');
