import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { testDb } from '../../../../../../test/setup/database';
import { reservationRepositoryContract } from '../../../testing/reservation-repository.contract';
import { PrismaReservationRepository } from './prisma-reservation.repository';

// 같은 스위트가 in-memory fake 위에서도 돈다.
reservationRepositoryContract(
  'prisma',
  async () => new PrismaReservationRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);
