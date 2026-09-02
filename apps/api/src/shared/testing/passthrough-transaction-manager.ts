import type { TransactionContext, TransactionManager } from '../kernel/ports/transaction-manager';

/**
 * 단위 테스트용 TransactionManager.
 * 실제 트랜잭션 없이 work를 그대로 실행한다. 인메모리 리포지토리와 함께 쓴다.
 */
export class PassthroughTransactionManager implements TransactionManager {
  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return work({} as TransactionContext);
  }
}
