import { testDb } from '../../../../../../test/setup/database';
import { cartRepositoryContract } from '../../../testing/cart-repository.contract';
import { PrismaCartRepository } from './prisma-cart.repository';

cartRepositoryContract('prisma', async () => new PrismaCartRepository(await testDb()));
