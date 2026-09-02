import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { AccountId, CustomerId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { CustomerRepository } from '../../../application/ports/out/customer.repository';
import type { Customer } from '../../../domain/customer';
import { toCustomerDomain, toSavedAddressRows } from './customer.mapper';

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: CustomerId, tx?: TransactionContext): Promise<Customer | null> {
    const row = await this.client(tx).customer.findUnique({
      where: { id },
      include: { addresses: true },
    });
    return row === null ? null : toCustomerDomain(row);
  }

  async findByAccountId(accountId: AccountId, tx?: TransactionContext): Promise<Customer | null> {
    const row = await this.client(tx).customer.findUnique({
      where: { accountId },
      include: { addresses: true },
    });
    return row === null ? null : toCustomerDomain(row);
  }

  /**
   * 주소록 전체를 애그리거트와 함께 쓴다.
   *
   * **삭제가 핵심이다.** upsert만 하면 도메인에서 지운 주소가 DB에 남아 다음 조회에서
   * 되살아난다. "지금 애그리거트에 없는 행은 지운다"가 애그리거트를 저장한다는 말의
   * 실제 의미다.
   *
   * 삭제를 먼저 하고 upsert를 나중에 하는 순서도 의도적이다. 기본 배송지를 A에서 B로
   * 옮기면서 A를 지우는 경우, 순서가 반대면 A와 B가 동시에 is_default=true인 순간이
   * 생겨 부분 유니크 인덱스에 걸린다.
   */
  async save(customer: Customer, tx?: TransactionContext): Promise<void> {
    const client = this.client(tx);
    const rows = toSavedAddressRows(customer);

    await client.customer.upsert({
      where: { id: customer.id },
      create: { id: customer.id, accountId: customer.accountId, createdAt: customer.createdAt },
      update: {},
    });

    await client.savedAddress.deleteMany({
      where: { customerId: customer.id, id: { notIn: rows.map((row) => row.id) } },
    });

    // 기본 해제를 먼저 반영해야 두 행이 동시에 is_default=true가 되는 순간이 없다.
    for (const row of rows.filter((row) => !row.isDefault)) {
      await client.savedAddress.upsert({ where: { id: row.id }, create: row, update: row });
    }
    for (const row of rows.filter((row) => row.isDefault)) {
      await client.savedAddress.upsert({ where: { id: row.id }, create: row, update: row });
    }
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
