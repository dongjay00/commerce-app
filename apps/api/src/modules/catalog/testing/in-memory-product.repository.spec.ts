import { InMemoryProductRepository } from './in-memory-product.repository';
import { productRepositoryContract } from './product-repository.contract';

productRepositoryContract('in-memory', async () => new InMemoryProductRepository());
