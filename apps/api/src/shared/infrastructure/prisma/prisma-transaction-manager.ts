import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  TransactionContext,
  TransactionManager,
} from '../../kernel/ports/transaction-manager';

/**
 * 불투명한 TransactionContext를 실제 Prisma 트랜잭션 클라이언트로 되돌린다.
 * 이 캐스팅은 어댑터 계층에만 존재해야 한다 — 애플리케이션이 이 함수를 부르면
 * dependency-cruiser의 application-knows-no-adapters 규칙이 잡아낸다.
 */
export function asPrismaClient(tx: TransactionContext): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}

export class PrismaTransactionManager implements TransactionManager {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) =>
      work(client as unknown as TransactionContext),
    );
  }
}
