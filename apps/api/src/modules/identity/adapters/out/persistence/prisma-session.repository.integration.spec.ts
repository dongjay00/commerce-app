import { testDb } from '../../../../../../test/setup/database';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { sessionRepositoryContract } from '../../../testing/session-repository.contract';
import { PrismaSessionRepository } from './prisma-session.repository';

// 같은 스위트가 in-memory fake 위에서도 돈다
// (testing/in-memory-session.repository.spec.ts). sessions.account_id에는 외래 키가
// 없으므로(별개의 애그리거트 루트) 세션 계약 테스트에는 accounts 행이 필요 없다.
// 파일 간 정리는 integration-setup.ts의 TRUNCATE가 한다.
//
// runInTransaction은 실물 PrismaTransactionManager로 만든다 — 이게 있어야 계약
// 스위트의 롤백 케이스가 실행된다.
sessionRepositoryContract(
  'prisma',
  async () => new PrismaSessionRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);
