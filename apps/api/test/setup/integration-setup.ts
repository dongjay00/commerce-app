import { afterAll, beforeAll, beforeEach } from 'vitest';
import { closeTestDb, testDb, truncateAll } from './database';

beforeAll(async () => {
  await testDb();
});

beforeEach(async () => {
  await truncateAll(await testDb());
});

afterAll(async () => {
  await closeTestDb();
});
