import { InMemorySessionRepository } from './in-memory-session.repository';
import { sessionRepositoryContract } from './session-repository.contract';

sessionRepositoryContract('in-memory', async () => new InMemorySessionRepository());
