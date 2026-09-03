/**
 * outbox payload에서 필드를 꺼낸다. JsonB에서 온 값이라 타입 보장이 없다.
 *
 * 캐스팅으로 넘기면 잘못된 payload가 조용히 `undefined`로 흘러 유스케이스가
 * `InvalidIdError`를 던지고, 원인이 payload인지 저장된 데이터인지 알 수 없게 된다.
 * 여기서 소리 나게 실패하면 릴레이의 `last_error`에 정확한 이유가 남는다.
 */
export function requireString(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: string,
): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${eventType} 이벤트의 payload에 문자열 "${key}"가 없습니다.`);
  }
  return value;
}

export function requireBoolean(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: string,
): boolean {
  const value = payload[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${eventType} 이벤트의 payload에 불린 "${key}"가 없습니다.`);
  }
  return value;
}
