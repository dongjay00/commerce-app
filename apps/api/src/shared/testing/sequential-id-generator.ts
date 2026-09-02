import type { IdGenerator } from '../kernel/ports/id-generator';

/**
 * 테스트용 결정적 ID 생성기.
 * 식별자 VO가 UUID 형식을 요구하므로, 카운터를 UUID의 마지막 노드에 채워 넣는다.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix: string = '00000000-0000-7000-8000-') {}

  nextId(): string {
    this.counter += 1;
    return `${this.prefix}${this.counter.toString(16).padStart(12, '0')}`;
  }

  reset(): void {
    this.counter = 0;
  }
}
