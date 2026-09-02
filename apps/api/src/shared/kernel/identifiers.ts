import { DomainError } from './domain-error';

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * 바깥에서 들어온 값(HTTP 본문·경로 파라미터)이 UUID 형식이 아닐 때 던진다.
 * 스펙 §8.4상 형식 검증은 어댑터(Zod)의 책임이라 여기 도달하는 건 원칙적으로 방어선이
 * 하나 더 있는 것이다. DomainError로 등록해 400을 내는 이유는 `GET /orders/abc`처럼
 * 이미 검증을 우회해 값 객체까지 도달한 잘못된 입력에 500을 돌려주는 것이 클라이언트에게
 * 거짓을 말하는 것이기 때문이다.
 */
export class InvalidIdError extends DomainError {
  static readonly CODE = 'INVALID_ID';
  readonly code = InvalidIdError.CODE;

  constructor(kind: string, value: string) {
    super(`${kind}는 UUID 형식이어야 합니다: "${value}"`);
  }
}

/**
 * 데이터베이스에서 읽어온 값이 UUID 형식이 아닐 때 던진다.
 *
 * `InvalidIdError`와 갈라놓은 이유가 이 파일에서 가장 중요한 판단이다. 두 경로가 같은
 * 예외를 던지면 **저장된 행이 깨진 상황에 400을 응답한다** — 클라이언트에게 "당신의
 * 요청이 잘못됐다"고 말하는 것인데, 요청은 멀쩡했고 우리 데이터가 깨진 것이다.
 * 사용자가 고칠 수 있는 게 없으므로 DomainError로 만들지 않고 500으로 떨어뜨린다.
 *
 * 영속 어댑터의 매퍼는 **반드시 `fromPersistence`를 쓴다.** `of`를 쓰면 위의 거짓말이
 * 그대로 돌아온다.
 */
export class CorruptedRecordError extends Error {
  constructor(kind: string, value: string) {
    super(`저장된 ${kind} 값이 UUID 형식이 아닙니다: "${value}"`);
    this.name = 'CorruptedRecordError';
    Error.captureStackTrace?.(this, CorruptedRecordError);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeIdFactory<T extends string>(kind: T) {
  return {
    /** 인바운드 경로 전용. 실패는 사용자 입력 오류(400). */
    of(value: string): Brand<string, T> {
      if (!UUID_PATTERN.test(value)) {
        throw new InvalidIdError(kind, value);
      }
      return value as Brand<string, T>;
    },
    /** 영속 복원 전용. 실패는 데이터 무결성 결함(500). */
    fromPersistence(value: string): Brand<string, T> {
      if (!UUID_PATTERN.test(value)) {
        throw new CorruptedRecordError(kind, value);
      }
      return value as Brand<string, T>;
    },
  };
}

// 타입 별칭을 손으로 쓰지 않고 팩토리 반환값에서 파생시킨다.
// 예전에는 `makeIdFactory('OrderId')`의 문자열 리터럴과 `type OrderId = Brand<string,'OrderId'>`를
// 사람이 맞춰야 했고 둘을 묶는 컴파일 검사가 없었다 — 식별자가 늘어날수록 복사-붙여넣기
// 실수가 조용히 통과한다. 아래 형태에서는 리터럴이 타입의 유일한 출처다.
export const OrderId = makeIdFactory('OrderId');
export type OrderId = ReturnType<typeof OrderId.of>;

export const CartId = makeIdFactory('CartId');
export type CartId = ReturnType<typeof CartId.of>;

export const SkuId = makeIdFactory('SkuId');
export type SkuId = ReturnType<typeof SkuId.of>;

export const ProductId = makeIdFactory('ProductId');
export type ProductId = ReturnType<typeof ProductId.of>;

export const CustomerId = makeIdFactory('CustomerId');
export type CustomerId = ReturnType<typeof CustomerId.of>;

export const AccountId = makeIdFactory('AccountId');
export type AccountId = ReturnType<typeof AccountId.of>;

export const SessionId = makeIdFactory('SessionId');
export type SessionId = ReturnType<typeof SessionId.of>;

export const ReservationId = makeIdFactory('ReservationId');
export type ReservationId = ReturnType<typeof ReservationId.of>;

export const PaymentId = makeIdFactory('PaymentId');
export type PaymentId = ReturnType<typeof PaymentId.of>;

export const AddressId = makeIdFactory('AddressId');
export type AddressId = ReturnType<typeof AddressId.of>;
