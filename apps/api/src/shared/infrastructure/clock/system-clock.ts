import type { Clock } from '../../kernel/ports/clock';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
