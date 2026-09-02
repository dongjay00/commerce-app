import { customerRepositoryContract } from './customer-repository.contract';
import { InMemoryCustomerRepository } from './in-memory-customer.repository';

customerRepositoryContract('in-memory', async () => new InMemoryCustomerRepository());
