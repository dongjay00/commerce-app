import type { EventTransport, OutboxRecord } from '../kernel/ports/event-transport';

/**
 * 릴레이 테스트용 fake.
 * failWhen으로 특정 레코드의 전송을 실패시켜 재시도 경로를 검증할 수 있다.
 */
export class RecordingEventTransport implements EventTransport {
  readonly sent: OutboxRecord[] = [];
  private shouldFail: ((record: OutboxRecord) => boolean) | undefined;

  failWhen(predicate: (record: OutboxRecord) => boolean): void {
    this.shouldFail = predicate;
  }

  succeedAlways(): void {
    this.shouldFail = undefined;
  }

  async send(record: OutboxRecord): Promise<void> {
    if (this.shouldFail?.(record)) {
      throw new Error(`전송 실패: ${record.eventType}`);
    }
    this.sent.push(record);
  }
}
