import { moneyDtoSchema } from '@commerce/contracts';
import { describe, expect, it } from 'vitest';
import { Money } from '../../kernel/money';

// 커널의 MoneyDto와 packages/contracts의 moneyDtoSchema는 서로를 모르는 독립된 선언이다
// (kernel-is-pure / domain-must-not-know-dto가 커널이 contracts를 import하는 것을 막는다).
// 이 spec은 둘을 볼 수 있는 유일한 계층(shared/infrastructure)에서 둘이 여전히 일치하는지 검증한다.
describe('Money ↔ moneyDtoSchema 계약 정합성', () => {
  it('Money.toDto()의 출력은 계약 스키마를 만족한다', () => {
    for (const m of [
      Money.of(0),
      Money.of(1000),
      Money.of(-500),
      Money.of(9_007_199_254_740_993n, 'USD'),
    ]) {
      expect(() => moneyDtoSchema.parse(m.toDto())).not.toThrow();
    }
  });

  it('계약 스키마를 통과한 DTO는 Money로 복원된다', () => {
    const dto = moneyDtoSchema.parse({ amount: '15000', currency: 'KRW' });
    expect(Money.fromDto(dto).amount).toBe(15000n);
  });

  it('통화 목록이 양쪽에서 같다', () => {
    expect(moneyDtoSchema.shape.currency.options).toEqual(['KRW', 'USD']);
  });
});
