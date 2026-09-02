import { describe, expect, it } from 'vitest';
import { AccountId, AddressId, CustomerId } from '../../../shared/kernel/identifiers';
import type { TransactionContext } from '../../../shared/kernel/ports/transaction-manager';
import type { CustomerRepository } from '../application/ports/out/customer.repository';
import { AddressDetails } from '../domain/address-details';
import { Customer } from '../domain/customer';

const NOW = new Date('2026-03-01T10:00:00.000Z');

function details(label: string): AddressDetails {
  return AddressDetails.of({
    label,
    recipient: '홍길동',
    phone: '010-1234-5678',
    zip: '06236',
    line1: '서울시 강남구 테헤란로 1',
    line2: label === '집' ? '101동' : null,
  });
}

function aCustomer(suffix: string): Customer {
  return Customer.register({
    id: CustomerId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dc05e${suffix}`),
    accountId: AccountId.of(`018f2b1c-4a5d-7e6f-8a9b-0c1dacc0${suffix}`),
    now: NOW,
  });
}

/**
 * CustomerRepository의 계약. in-memory fake와 Prisma 어댑터 양쪽이 통과해야 한다.
 * `createRepo`는 매 테스트마다 **비어 있는** 리포지토리를 돌려줘야 한다.
 *
 * `runInTransaction`은 실물 트랜잭션 매니저가 있을 때만 넘긴다. in-memory 호출부는
 * 이걸 생략한다 — `PassthroughTransactionManager`는 롤백을 흉내내지 않으므로, 거기서
 * 롤백 테스트를 돌리면 통과하는 무의미한 테스트가 되고, 그건 테스트가 없는 것보다 나쁘다.
 */
export function customerRepositoryContract(
  name: string,
  createRepo: () => Promise<CustomerRepository>,
  runInTransaction?: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>,
): void {
  describe(`CustomerRepository 계약 — ${name}`, () => {
    it('저장한 고객을 ID로 찾는다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0001');
      await repo.save(customer);
      expect((await repo.findById(customer.id))?.accountId).toBe(customer.accountId);
    });

    it('계정 ID로도 찾는다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0002');
      await repo.save(customer);
      expect((await repo.findByAccountId(customer.accountId))?.id).toBe(customer.id);
    });

    it('없는 ID는 null을 반환한다', async () => {
      const repo = await createRepo();
      expect(await repo.findById(CustomerId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dc05e9999'))).toBeNull();
      expect(
        await repo.findByAccountId(AccountId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dacc09999')),
      ).toBeNull();
    });

    it('주소록이 애그리거트와 함께 저장되고 복원된다', async () => {
      // SavedAddress는 애그리거트 안이다. 따로 저장할 방법이 없어야 한다.
      const repo = await createRepo();
      const customer = aCustomer('0003');
      customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd10001'), details('집'));
      customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd10002'), details('회사'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      expect(loaded?.addressBook.all).toHaveLength(2);
    });

    it('주소의 모든 필드가 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0004');
      const addressId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd20001');
      customer.addAddress(addressId, details('집'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      const saved = loaded?.addressBook.all.find((a) => a.id === addressId);
      expect(saved?.details.equals(details('집'))).toBe(true);
    });

    it('line2가 null인 주소도 그대로 보존된다', async () => {
      // ''로 저장되면 도메인의 정규화(빈 문자열 → null)와 어긋나 equals가 깨진다.
      const repo = await createRepo();
      const customer = aCustomer('0005');
      const addressId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd30001');
      customer.addAddress(addressId, details('회사'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      expect(loaded?.addressBook.all.find((a) => a.id === addressId)?.details.line2).toBeNull();
    });

    it('기본 배송지 표시가 왕복해도 보존된다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0006');
      const first = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd40001');
      const second = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd40002');
      customer.addAddress(first, details('집'));
      customer.addAddress(second, details('회사'));
      customer.setDefaultAddress(second);
      await repo.save(customer);

      expect((await repo.findById(customer.id))?.addressBook.defaultAddress?.id).toBe(second);
    });

    it('기본 배송지를 A에서 B로 옮기고 다시 저장해도 유지된다', async () => {
      // 위 케이스와 다르다: 저장이 두 번이다. 첫 저장에서 first가 이미 is_default=true로
      // DB에 있는 상태에서, 두 번째 저장이 그 표시를 second로 옮긴다. 어댑터가 기본
      // 해제(first)보다 기본 설정(second)을 먼저 쓰면, 그 사이 순간에 두 행이 동시에
      // is_default=true가 되어 부분 유니크 인덱스에 걸린다.
      const repo = await createRepo();
      const customer = aCustomer('000a');
      const first = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd4b001');
      const second = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd4b002');
      customer.addAddress(first, details('집'));
      customer.addAddress(second, details('회사'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      loaded?.setDefaultAddress(second);
      if (loaded) await repo.save(loaded);

      const reloaded = await repo.findById(customer.id);
      expect(reloaded?.addressBook.defaultAddress?.id).toBe(second);
    });

    it('삭제된 주소는 다시 저장해도 되살아나지 않는다', async () => {
      // 어댑터가 upsert만 하고 삭제를 하지 않으면, 지운 주소가 다음 조회에서 되돌아온다.
      const repo = await createRepo();
      const customer = aCustomer('0007');
      const addressId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd50001');
      customer.addAddress(addressId, details('집'));
      customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd50002'), details('회사'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      loaded?.removeAddress(addressId);
      if (loaded) await repo.save(loaded);

      const reloaded = await repo.findById(customer.id);
      expect(reloaded?.addressBook.all.map((a) => a.id)).not.toContain(addressId);
      expect(reloaded?.addressBook.all).toHaveLength(1);
    });

    it('마지막 주소를 지우고 다시 저장하면 주소록이 완전히 비워진다', async () => {
      // 위 케이스("삭제된 주소는 다시 저장해도 되살아나지 않는다")는 언제나 주소 하나를
      // 남기므로 두 번째 저장의 rows가 절대 비지 않는다. `저장 후 원본을 변경해도
      // 저장본은 바뀌지 않는다`도 첫 저장 시점에 이미 저장된 행이 하나도 없으므로,
      // `deleteMany({ notIn: [] })`가 "전부 삭제"든 "아무것도 안 함"이든 결과가
      // 똑같다. 이 케이스만 "이미 저장된 행이 있는 상태에서 rows가 빈 배열이 되는"
      // 유일한 경로를 지나가고, 그것이 어댑터의 `notIn: []` 처리를 실제로 가른다.
      const repo = await createRepo();
      const customer = aCustomer('000b');
      const addressId = AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1daddc0001');
      customer.addAddress(addressId, details('집'));
      await repo.save(customer);

      const loaded = await repo.findById(customer.id);
      loaded?.removeAddress(addressId);
      if (loaded) await repo.save(loaded);

      const reloaded = await repo.findById(customer.id);
      expect(reloaded?.addressBook.all).toEqual([]);
    });

    it('저장 후 원본을 변경해도 저장본은 바뀌지 않는다', async () => {
      const repo = await createRepo();
      const customer = aCustomer('0008');
      await repo.save(customer);

      customer.addAddress(AddressId.of('018f2b1c-4a5d-7e6f-8a9b-0c1dadd60001'), details('집'));

      expect((await repo.findById(customer.id))?.addressBook.all).toEqual([]);
    });

    it.skipIf(runInTransaction === undefined)(
      '트랜잭션이 롤백되면 그 안에서 저장한 고객도 사라진다',
      async () => {
        // tx를 무시하고 항상 기본 클라이언트로 쓰는 어댑터는 이 테스트 없이도 위의
        // 모든 케이스를 통과한다 — 자기가 방금 쓴 걸 트랜잭션 밖에서 그대로 읽어올
        // 뿐이기 때문이다. `save`가 customer upsert·삭제 동기화·upsert 두 패스까지
        // 네 개의 문장으로 나뉘어 있어서(태스크 14), 그중 하나라도 트랜잭션 클라이언트를
        // 타지 않으면 중간에 실패했을 때 주소록이 반쯤 쓰인 채로 남는다 — 이 테스트가
        // 그 경로를 잡는다.
        const runner = runInTransaction;
        if (!runner) {
          // skipIf가 이미 이 케이스를 건너뛴다 — 타입만 좁힌다.
          return;
        }
        const repo = await createRepo();
        const customer = aCustomer('0009');

        await expect(
          runner(async (tx) => {
            await repo.save(customer, tx);
            throw new Error('의도된 실패');
          }),
        ).rejects.toThrow('의도된 실패');

        expect(await repo.findById(customer.id)).toBeNull();
      },
    );
  });
}
