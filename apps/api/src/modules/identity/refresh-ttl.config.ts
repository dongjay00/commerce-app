import { Duration } from '../../shared/kernel/duration';

const DEFAULT_DAYS = 14;

export function readRefreshTtl(env: NodeJS.ProcessEnv): Duration {
  const raw = env['REFRESH_TOKEN_TTL_DAYS'];
  if (raw === undefined) {
    return Duration.hours(24 * DEFAULT_DAYS);
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`REFRESH_TOKEN_TTL_DAYS는 양의 정수여야 합니다: "${raw}"`);
  }
  // Duration에 days 팩토리가 없다. hours로 만든다.
  return Duration.hours(24 * days);
}
