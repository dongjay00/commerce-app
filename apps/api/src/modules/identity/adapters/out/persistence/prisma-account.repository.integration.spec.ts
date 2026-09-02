import { describe, expect, it } from 'vitest';
import { testDb } from '../../../../../../test/setup/database';
import { PrismaTransactionManager } from '../../../../../shared/infrastructure/prisma/prisma-transaction-manager';
import { AccountId } from '../../../../../shared/kernel/identifiers';
import { Account } from '../../../domain/account';
import { EmailAlreadyRegisteredError } from '../../../domain/account.errors';
import { Credential } from '../../../domain/credential';
import { Email } from '../../../domain/email';
import { accountRepositoryContract } from '../../../testing/account-repository.contract';
import { PrismaAccountRepository } from './prisma-account.repository';

// 같은 스위트가 in-memory fake 위에서도 돈다
// (testing/in-memory-account.repository.spec.ts). 두 구현이 같은 계약을 통과해야
// 유스케이스 테스트 수십 개가 fake 위에서 빠르게 돌면서도 실물과 어긋나지 않는다.
// 파일 간 정리는 integration-setup.ts의 TRUNCATE가 한다.
//
// runInTransaction은 실물 PrismaTransactionManager로 만든다 — 이게 있어야 계약
// 스위트의 롤백 케이스가 실행된다.
accountRepositoryContract(
  'prisma',
  async () => new PrismaAccountRepository(await testDb()),
  async (work) => new PrismaTransactionManager(await testDb()).run(work),
);

describe('동시 가입 경합', () => {
  it('같은 이메일로 동시에 두 계정을 저장하면 정확히 하나만 성공한다', async () => {
    // 유스케이스의 사전 조회(findByEmail)는 두 요청이 동시에 통과할 수 있다.
    // 유일성의 진짜 근거는 DB의 unique 인덱스이고, 이 테스트가 그것을 확인한다.
    // 트랜잭션 안에서 감싸 롤백하는 방식으로는 이 경합을 재현할 수 없다 (스펙 §9.5).
    const repo = new PrismaAccountRepository(await testDb());
    const now = new Date('2026-03-01T10:00:00.000Z');

    const make = (suffix: string): Account => {
      const account = Account.register({
        id: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dcccc${suffix}`),
        email: Email.of('race@example.com'),
        credential: Credential.fromHash(`$argon2id$${suffix}`),
        now,
      });
      account.pullEvents();
      return account;
    };

    const results = await Promise.allSettled([repo.save(make('0001')), repo.save(make('0002'))]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // 500이 아니라 409로 나가야 한다.
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });
});
