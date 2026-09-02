import { describe, expect, it } from 'vitest';
import { AccountId } from '../../../shared/kernel/identifiers';
import type { AccountRepository } from '../application/ports/out/account.repository';
import { Account } from '../domain/account';
import { EmailAlreadyRegisteredError } from '../domain/account.errors';
import { Credential } from '../domain/credential';
import { Email } from '../domain/email';

const NOW = new Date('2026-03-01T10:00:00.000Z');

function anAccount(idSuffix: string, email: string): Account {
  return Account.register({
    id: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f${idSuffix}`),
    email: Email.of(email),
    credential: Credential.fromHash(`$argon2id$${idSuffix}`),
    now: NOW,
  });
}

/**
 * AccountRepository의 계약. in-memory fake와 Prisma 어댑터 양쪽이 통과해야 한다.
 * `createRepo`는 매 테스트마다 **비어 있는** 리포지토리를 돌려줘야 한다.
 */
export function accountRepositoryContract(
  name: string,
  createRepo: () => Promise<AccountRepository>,
): void {
  describe(`AccountRepository 계약 — ${name}`, () => {
    it('저장한 계정을 ID로 찾는다', async () => {
      const repo = await createRepo();
      const account = anAccount('0001', 'a@example.com');
      await repo.save(account);

      const found = await repo.findById(account.id);
      expect(found?.id).toBe(account.id);
      expect(found?.email.value).toBe('a@example.com');
    });

    it('저장한 계정을 이메일로 찾는다', async () => {
      const repo = await createRepo();
      const account = anAccount('0002', 'b@example.com');
      await repo.save(account);

      const found = await repo.findByEmail(Email.of('b@example.com'));
      expect(found?.id).toBe(account.id);
    });

    it('이메일 조회는 정규화된 값을 쓴다', async () => {
      // Email VO가 소문자로 정규화하므로 대문자로 조회해도 같은 계정이 나와야 한다.
      // 어댑터가 원본 문자열을 저장하면 여기서 깨진다.
      const repo = await createRepo();
      await repo.save(anAccount('0003', 'Mixed@Example.COM'));

      expect(await repo.findByEmail(Email.of('mixed@example.com'))).not.toBeNull();
      expect(await repo.findByEmail(Email.of('MIXED@EXAMPLE.COM'))).not.toBeNull();
    });

    it('없는 ID는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f9999'))).toBeNull();
    });

    it('없는 이메일은 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findByEmail(Email.of('nobody@example.com'))).toBeNull();
    });

    it('자격증명과 갱신 시각이 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const account = anAccount('0004', 'c@example.com');
      await repo.save(account);

      const changedAt = new Date('2026-06-01T00:00:00.000Z');
      const loaded = await repo.findById(account.id);
      loaded?.changeCredential(Credential.fromHash('$argon2id$rotated'), changedAt);
      if (loaded) await repo.save(loaded);

      const reloaded = await repo.findById(account.id);
      expect(reloaded?.credential.hash).toBe('$argon2id$rotated');
      expect(reloaded?.updatedAt).toEqual(changedAt);
      expect(reloaded?.createdAt).toEqual(NOW);
    });

    it('복원된 계정은 미커밋 이벤트를 갖지 않는다', async () => {
      // 복원이 이벤트를 쌓으면 조회할 때마다 AccountRegistered가 outbox에 다시 들어간다.
      const repo = await createRepo();
      const account = anAccount('0005', 'd@example.com');
      await repo.save(account);

      const loaded = await repo.findById(account.id);
      expect(loaded?.hasUncommittedEvents).toBe(false);
    });

    it('같은 계정을 두 번 저장하면 갱신된다 — 행이 늘지 않는다', async () => {
      const repo = await createRepo();
      const account = anAccount('0006', 'e@example.com');
      await repo.save(account);
      await repo.save(account);

      expect(await repo.findById(account.id)).not.toBeNull();
      expect(await repo.findByEmail(Email.of('e@example.com'))).not.toBeNull();
    });

    it('다른 계정이 같은 이메일을 쓰면 EmailAlreadyRegisteredError를 던진다', async () => {
      // fake가 이 규칙을 흉내내지 않으면, 유스케이스 테스트는 fake 위에서 통과하고
      // 운영에서만 P2002가 500으로 터진다. 계약 테스트가 그 드리프트를 막는다.
      const repo = await createRepo();
      await repo.save(anAccount('0007', 'dup@example.com'));

      await expect(repo.save(anAccount('0008', 'dup@example.com'))).rejects.toThrow(
        EmailAlreadyRegisteredError,
      );
    });

    it('저장 후 원본 애그리거트를 변경해도 저장본은 바뀌지 않는다', async () => {
      // 저장이 참조를 그대로 들고 있으면(fake에서 흔한 실수) 트랜잭션 롤백 뒤에도
      // 메모리의 값이 살아남아 테스트가 거짓으로 통과한다.
      const repo = await createRepo();
      const account = anAccount('0009', 'f@example.com');
      await repo.save(account);

      account.changeCredential(Credential.fromHash('$argon2id$mutated-after-save'), NOW);

      const loaded = await repo.findById(account.id);
      expect(loaded?.credential.hash).toBe('$argon2id$0009');
    });
  });
}
