import type { Duration } from '../kernel/duration';
import type { Clock } from '../kernel/ports/clock';

/** 테스트용 Clock. 시간을 임의로 앞당길 수 있다. */
export class MutableClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceBy(duration: Duration): void {
    this.current = new Date(this.current.getTime() + duration.millis);
  }

  setTo(instant: Date): void {
    this.current = new Date(instant.getTime());
  }
}
