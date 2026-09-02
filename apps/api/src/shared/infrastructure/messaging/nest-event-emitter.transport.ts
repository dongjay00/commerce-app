import { Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 design:paramtypes 런타임 값을 요구한다 — type-only면 주입이 깨진다.
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EventTransport, OutboxRecord } from '../../kernel/ports/event-transport';

/**
 * 같은 프로세스 안에서 이벤트를 전달하는 어댑터.
 * 나중에 Kafka 어댑터로 교체할 자리이며, OutboxRelay는 바뀌지 않는다.
 */
@Injectable()
export class NestEventEmitterTransport implements EventTransport {
  constructor(private readonly emitter: EventEmitter2) {}

  async send(record: OutboxRecord): Promise<void> {
    await this.emitter.emitAsync(record.eventType, record);
  }
}
