import { describe, expect, it } from 'vitest';
import { Duration } from '../kernel/duration';
import { MutableClock } from './mutable-clock';

const START = new Date('2026-01-01T00:00:00.000Z');

describe('MutableClock', () => {
  it('생성 시각을 그대로 반환한다', () => {
    expect(new MutableClock(START).now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('같은 시각을 여러 번 물어도 값이 변하지 않는다', () => {
    const clock = new MutableClock(START);
    expect(clock.now().getTime()).toBe(clock.now().getTime());
  });

  it('advanceBy로 시간을 앞당긴다', () => {
    const clock = new MutableClock(START);
    clock.advanceBy(Duration.minutes(16));
    expect(clock.now().toISOString()).toBe('2026-01-01T00:16:00.000Z');
  });

  it('advanceBy를 여러 번 호출하면 누적된다', () => {
    const clock = new MutableClock(START);
    clock.advanceBy(Duration.minutes(10));
    clock.advanceBy(Duration.minutes(5));
    expect(clock.now().toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });

  it('setTo로 특정 시각에 고정한다', () => {
    const clock = new MutableClock(START);
    clock.setTo(new Date('2026-03-15T12:30:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-03-15T12:30:00.000Z');
  });

  it('반환된 Date를 변형해도 시계에 영향이 없다', () => {
    const clock = new MutableClock(START);
    clock.now().setFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
