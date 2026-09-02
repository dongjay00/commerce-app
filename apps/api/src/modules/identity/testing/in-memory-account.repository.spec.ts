import { accountRepositoryContract } from './account-repository.contract';
import { InMemoryAccountRepository } from './in-memory-account.repository';

accountRepositoryContract('in-memory', async () => new InMemoryAccountRepository());
