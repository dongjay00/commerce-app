import { testDb } from '../../../../../../test/setup/database';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { productRepositoryContract } from '../../../testing/product-repository.contract';
import { PrismaProductRepository } from './prisma-product.repository';

// 같은 스위트가 in-memory fake 위에서도 돈다(testing/in-memory-product.repository.spec.ts).
// 두 구현이 같은 계약을 통과해야 fake가 실물과 드리프트할 수 없다.
productRepositoryContract(
  'prisma',
  async () => new PrismaProductRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);
