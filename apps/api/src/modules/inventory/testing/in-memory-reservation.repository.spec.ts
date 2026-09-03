import { InMemoryReservationRepository } from './in-memory-reservation.repository';
import { reservationRepositoryContract } from './reservation-repository.contract';

reservationRepositoryContract('in-memory', async () => new InMemoryReservationRepository());
