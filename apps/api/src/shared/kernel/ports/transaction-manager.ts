declare const transactionContextBrand: unique symbol;

/**
 * 트랜잭션 핸들. 애플리케이션 계층은 이 값의 내부를 절대 들여다보지 않고
 * 리포지토리 포트에 그대로 넘기기만 한다.
 * 실제 Prisma 클라이언트로 되돌리는 캐스팅은 어댑터의 asPrismaClient()에만 존재한다.
 */
export type TransactionContext = { readonly [transactionContextBrand]: true };

export interface TransactionManager {
  /** work가 예외를 던지면 트랜잭션 전체가 롤백된다. */
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export const TRANSACTION_MANAGER = Symbol('TransactionManager');
