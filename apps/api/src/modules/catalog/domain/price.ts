import type { Currency } from '../../../shared/kernel/money';
import { Money } from '../../../shared/kernel/money';
import { CorruptedPriceError, InvalidPriceError } from './catalog.errors';

/**
 * 판매 가격 값 객체.
 *
 * `Money`를 그대로 쓰지 않는 이유는 하나뿐이다: **판매 가격은 0보다 커야 한다.**
 * `Money`는 0과 음수를 허용해야 하고(환불·차감의 중간값), 그 관대함이 상품 가격에
 * 그대로 흘러들면 0원 상품이 재고와 결제 경로를 통과한다.
 */
export class Price {
  private constructor(readonly money: Money) {}

  /** 인바운드 경로. 실패는 사용자 입력 오류(400). */
  static of(money: Money): Price {
    if (money.amount <= 0n) {
      throw new InvalidPriceError(money.amount);
    }
    return new Price(money);
  }

  /** 영속 복원 전용. 실패는 데이터 무결성 결함(500). */
  static fromPersistence(amount: bigint, currency: Currency): Price {
    if (amount <= 0n) {
      throw new CorruptedPriceError(amount);
    }
    return new Price(Money.of(amount, currency));
  }

  equals(other: Price): boolean {
    return this.money.equals(other.money);
  }
}
