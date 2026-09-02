import type { PrismaClient } from '@prisma/client';
import { asPrismaClient } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import type { AccountId } from '../../../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../../../shared/kernel/ports/transaction-manager';
import type { AccountRepository } from '../../../application/ports/out/account.repository';
import type { Account } from '../../../domain/account';
import { EmailAlreadyRegisteredError } from '../../../domain/account.errors';
import type { Email } from '../../../domain/email';
import { toAccountDomain, toAccountRow } from './account.mapper';

/** Prisma가 유니크 제약 위반에 쓰는 코드. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Prisma 7의 클라이언트는 Proxy라 `instanceof`가 프로토타입 체인을 타고 성립하지
 * 않는 경우가 있다(계획 1의 `app.module.spec.ts` 참고). 오류 판별도 클래스 대신
 * 구조적으로 한다 — `Prisma.PrismaClientKnownRequestError`를 import하지 않으면
 * 이 파일이 Prisma의 내부 클래스 구조 변화에 묶이지도 않는다.
 *
 * `meta.target`을 보지 않는다. 드라이버 어댑터(`@prisma/adapter-pg`, `testDb()`와
 * `PrismaService` 둘 다 이걸 쓴다)를 통한 P2002는 `target`이 아예 없고, 대신
 * `meta.driverAdapterError.cause.constraint`에 실패한 인덱스/컬럼 정보가 실린다
 * (실측: `{ driverAdapterError: { cause: { constraint: { index: 'accounts_email_key' } } } }`,
 * `target` 필드 없음). 두 모양을 다 구조적으로 훑는다.
 */
function extractViolationTargets(meta: unknown): readonly string[] {
  if (typeof meta !== 'object' || meta === null) {
    return [];
  }
  const record = meta as Record<string, unknown>;

  if (Array.isArray(record.target)) {
    return record.target.filter((t): t is string => typeof t === 'string');
  }
  if (typeof record.target === 'string') {
    return [record.target];
  }

  const constraint = (record.driverAdapterError as { cause?: { constraint?: unknown } } | undefined)
    ?.cause?.constraint as { fields?: unknown; index?: unknown } | undefined;
  if (Array.isArray(constraint?.fields)) {
    return constraint.fields.filter((f): f is string => typeof f === 'string');
  }
  if (typeof constraint?.index === 'string') {
    return [constraint.index];
  }

  return [];
}

function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== UNIQUE_VIOLATION) {
    return false;
  }
  return extractViolationTargets(candidate.meta).some((target) => target.includes(field));
}

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: AccountId, tx?: TransactionContext): Promise<Account | null> {
    const row = await this.client(tx).account.findUnique({ where: { id } });
    return row === null ? null : toAccountDomain(row);
  }

  async findByEmail(email: Email, tx?: TransactionContext): Promise<Account | null> {
    // Email VO가 소문자로 정규화한 값으로만 조회한다. DB에 저장된 값도 같은 정규화를
    // 거친 값이므로 대소문자 무시 비교(citext, ILIKE)가 필요 없다 — 그리고 그런 비교는
    // unique 인덱스를 무력화한다.
    const row = await this.client(tx).account.findUnique({ where: { email: email.value } });
    return row === null ? null : toAccountDomain(row);
  }

  async save(account: Account, tx?: TransactionContext): Promise<void> {
    const row = toAccountRow(account);
    try {
      await this.client(tx).account.upsert({
        where: { id: row.id },
        create: row,
        update: {
          email: row.email,
          passwordHash: row.passwordHash,
          updatedAt: row.updatedAt,
        },
      });
    } catch (error) {
      // 유스케이스의 사전 조회를 두 요청이 동시에 통과한 경우 여기가 마지막 방어선이다.
      // 번역하지 않으면 500이 나가고, 사용자는 "서버 오류"를 보며 재시도한다.
      if (isUniqueViolationOn(error, 'email')) {
        throw new EmailAlreadyRegisteredError(row.email);
      }
      throw error;
    }
  }

  private client(tx?: TransactionContext): PrismaClient {
    return tx ? (asPrismaClient(tx) as PrismaClient) : this.prisma;
  }
}
