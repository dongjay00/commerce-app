export interface JwtConfig {
  readonly secret: string;
  readonly accessTokenTtlSeconds: number;
}

const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_SECONDS = 900;

/**
 * 부팅 시 한 번 읽는다. 잘못된 설정은 **부팅을 실패시킨다** — 첫 로그인 요청에서
 * 500으로 드러나는 것보다 낫다.
 */
export function readJwtConfig(env: NodeJS.ProcessEnv): JwtConfig {
  const secret = env['JWT_SECRET'];
  if (!secret) {
    throw new Error('JWT_SECRET이 설정되지 않았습니다. apps/api/.env를 확인하세요.');
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET은 ${MIN_SECRET_LENGTH}자 이상이어야 합니다.`);
  }

  const raw = env['ACCESS_TOKEN_TTL_SECONDS'];
  if (raw === undefined) {
    return { secret, accessTokenTtlSeconds: DEFAULT_TTL_SECONDS };
  }

  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error(`ACCESS_TOKEN_TTL_SECONDS는 양의 정수여야 합니다: "${raw}"`);
  }
  return { secret, accessTokenTtlSeconds: ttl };
}
