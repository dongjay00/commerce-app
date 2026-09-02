export class InvalidDurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDurationError';
  }
}

/** 기간 값 객체. 예약 TTL 계산과 테스트에서의 시간 조작에 쓴다. */
export class Duration {
  private constructor(readonly millis: number) {}

  static ofMillis(millis: number): Duration {
    if (!Number.isInteger(millis)) {
      throw new InvalidDurationError(`기간은 정수 밀리초여야 합니다: ${millis}`);
    }
    if (millis < 0) {
      throw new InvalidDurationError(`기간은 0 이상이어야 합니다: ${millis}`);
    }
    return new Duration(millis);
  }

  static seconds(value: number): Duration {
    return Duration.ofMillis(value * 1000);
  }

  static minutes(value: number): Duration {
    return Duration.ofMillis(value * 60_000);
  }

  static hours(value: number): Duration {
    return Duration.ofMillis(value * 3_600_000);
  }

  plus(other: Duration): Duration {
    return new Duration(this.millis + other.millis);
  }

  isLongerThan(other: Duration): boolean {
    return this.millis > other.millis;
  }

  equals(other: Duration): boolean {
    return this.millis === other.millis;
  }
}
