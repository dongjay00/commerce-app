import { cartRepositoryContract } from './cart-repository.contract';
import { InMemoryCartRepository } from './in-memory-cart.repository';

cartRepositoryContract('in-memory', async () => new InMemoryCartRepository());
