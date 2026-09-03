import { testDb } from '../../../../../../test/setup/database';
import { stockConcurrencyContract } from '../../../testing/stock-concurrency.contract';
import { OptimisticStockRepository } from './optimistic-stock.repository';
import { PessimisticStockRepository } from './pessimistic-stock.repository';

stockConcurrencyContract('pessimistic', testDb, (prisma) => new PessimisticStockRepository(prisma));

stockConcurrencyContract(
  'optimistic',
  testDb,
  (prisma) => new OptimisticStockRepository(prisma),
  (repo) => (repo as OptimisticStockRepository).retries,
);
