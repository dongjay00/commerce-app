import { describe, expect, it } from 'vitest';
import { Duration, InvalidDurationError } from './duration';

describe('Duration', () => {
  it('밀리초 단위로 보관한다', () => {
    expect(Duration.ofMillis(1500).millis).toBe(1500);
  });

  it('초·분·시를 밀리초로 환산한다', () => {
    expect(Duration.seconds(2).millis).toBe(2000);
    expect(Duration.minutes(15).millis).toBe(900_000);
    expect(Duration.hours(1).millis).toBe(3_600_000);
  });

  it('음수를 거부한다', () => {
    expect(() => Duration.ofMillis(-1)).toThrow(InvalidDurationError);
  });

  it('초·분·시 팩토리도 음수를 거부한다', () => {
    // 셋 다 ofMillis에 위임한다. 누가 검증을 팩토리 하나에만 직접 써넣거나
    // 빼먹어도 잡을 수 있도록 세 팩토리를 각각 확인한다.
    expect(() => Duration.seconds(-1)).toThrow(InvalidDurationError);
    expect(() => Duration.minutes(-1)).toThrow(InvalidDurationError);
    expect(() => Duration.hours(-1)).toThrow(InvalidDurationError);
  });

  it('소수 밀리초를 거부한다', () => {
    expect(() => Duration.ofMillis(1.5)).toThrow(InvalidDurationError);
  });

  it('더한다', () => {
    expect(Duration.minutes(10).plus(Duration.minutes(5)).millis).toBe(900_000);
  });

  it('길이를 비교한다', () => {
    expect(Duration.minutes(16).isLongerThan(Duration.minutes(15))).toBe(true);
    expect(Duration.minutes(15).isLongerThan(Duration.minutes(15))).toBe(false);
  });

  it('값이 같으면 같다', () => {
    expect(Duration.minutes(1).equals(Duration.seconds(60))).toBe(true);
  });
});
