import { testDb } from '../../../../../../test/setup/database';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { customerRepositoryContract } from '../../../testing/customer-repository.contract';
import { PrismaCustomerRepository } from './prisma-customer.repository';

// 같은 스위트가 in-memory fake 위에서도 돈다
// (testing/in-memory-customer.repository.spec.ts). 두 구현이 같은 계약을 통과해야
// 유스케이스 테스트들이 fake 위에서 빠르게 돌면서도 실물과 어긋나지 않는다.
// 파일 간 정리는 integration-setup.ts의 TRUNCATE가 한다.
//
// runInTransaction은 실물 PrismaTransactionManager로 만든다 — 이게 있어야 계약
// 스위트의 롤백 케이스가 실행된다.
//
// 계약의 aCustomer는 accounts 행을 만들지 않는다. customers.account_id에는 외래
// 키가 없으므로(애그리거트 경계, 태스크 11 참고) 그대로 통과해야 한다.
customerRepositoryContract(
  'prisma',
  async () => new PrismaCustomerRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);
