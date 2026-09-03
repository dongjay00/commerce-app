import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { Money } from '../../../shared/kernel/money';
import { CorruptedPriceError, InvalidPriceError } from './catalog.errors';
import { Price } from './price';

const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;

describe('Price.of', () => {
  it('양수 금액으로 가격을 만든다', () => {
    expect(Price.of(Money.of(1500n)).money.amount).toBe(1500n);
  });

  it('통화를 보존한다', () => {
    expect(Price.of(Money.of(1500n, 'USD')).money.currency).toBe('USD');
  });

  it('0원을 거부한다', () => {
    // Money는 0을 허용해야 한다(환불 계산의 중간값). 가격은 다르다 —
    // 0원짜리 판매 상품은 재고와 결제 경로 전체에서 의미가 무너진다.
    expect(() => Price.of(Money.of(0n))).toThrow(InvalidPriceError);
  });

  it('음수를 거부한다', () => {
    expect(() => Price.of(Money.of(-1n))).toThrow(InvalidPriceError);
  });

  it('실패는 DomainError다 — 사용자가 고칠 수 있는 입력이다', () => {
    expect(() => Price.of(Money.of(0n))).toThrow(DomainErrorConstructor);
  });
});

describe('Price.fromPersistence', () => {
  it('저장된 값을 복원한다', () => {
    const price = Price.fromPersistence(1500n, 'KRW');
    expect(price.money.amount).toBe(1500n);
    expect(price.money.currency).toBe('KRW');
  });

  it('깨진 저장 값의 실패는 DomainError가 아니다', () => {
    // 저장된 가격이 0이면 우리 데이터가 깨진 것이지 요청이 잘못된 게 아니다.
    // DomainError면 예외 필터가 400을 내보내 클라이언트에게 거짓을 말한다.
    expect(() => Price.fromPersistence(0n, 'KRW')).toThrow(CorruptedPriceError);
    expect(() => Price.fromPersistence(0n, 'KRW')).not.toThrow(DomainErrorConstructor);
  });
});

describe('Price.equals', () => {
  it('금액과 통화가 같으면 참이다', () => {
    expect(Price.of(Money.of(100n)).equals(Price.of(Money.of(100n)))).toBe(true);
  });

  it('통화가 다르면 거짓이다', () => {
    expect(Price.of(Money.of(100n, 'KRW')).equals(Price.of(Money.of(100n, 'USD')))).toBe(false);
  });
});
