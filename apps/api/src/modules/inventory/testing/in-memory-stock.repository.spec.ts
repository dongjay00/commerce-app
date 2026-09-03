import { InMemoryStockRepository } from './in-memory-stock.repository';
import { stockRepositoryContract } from './stock-repository.contract';

stockRepositoryContract('in-memory', async () => new InMemoryStockRepository());
