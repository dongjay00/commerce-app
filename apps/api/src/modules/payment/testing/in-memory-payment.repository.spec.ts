import { InMemoryPaymentRepository } from './in-memory-payment.repository';
import { paymentRepositoryContract } from './payment-repository.contract';

paymentRepositoryContract('in-memory', async () => new InMemoryPaymentRepository());
