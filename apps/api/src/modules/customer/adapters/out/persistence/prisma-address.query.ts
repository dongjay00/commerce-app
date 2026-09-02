import type { PrismaClient } from '@prisma/client';
import type { CustomerId } from '../../../../../shared/kernel/identifiers';
import type { AddressQuery, AddressView } from '../../../application/ports/out/address.query';

/**
 * 조회 전용. 애그리거트를 만들지 않고 필요한 컬럼만 골라 읽기 모델로 바로 옮긴다
 * (스펙 §7.2). `Customer.rehydrate`를 거치지 않으므로 불변식 검증 비용도 없다.
 */
export class PrismaAddressQuery implements AddressQuery {
  constructor(private readonly prisma: PrismaClient) {}

  async listByCustomer(customerId: CustomerId): Promise<AddressView[]> {
    const rows = await this.prisma.savedAddress.findMany({
      where: { customerId },
      select: {
        id: true,
        label: true,
        recipient: true,
        phone: true,
        zip: true,
        line1: true,
        line2: true,
        isDefault: true,
      },
      // 기본 배송지가 맨 앞. 그 다음은 라벨 순으로 안정 정렬한다 — 정렬을 지정하지
      // 않으면 Postgres는 순서를 보장하지 않고, 화면의 목록이 새로고침마다 뒤바뀐다.
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
    });
    return rows;
  }
}
