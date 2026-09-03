import { InMemoryOrderRepository } from './in-memory-order.repository';
import { orderRepositoryContract } from './order-repository.contract';

orderRepositoryContract('in-memory', async () => new InMemoryOrderRepository());
