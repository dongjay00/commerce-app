import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../../shared/kernel/domain-error';
import { CorruptedShippingAddressError, InvalidShippingAddressError } from './order.errors';
import { ShippingAddress } from './shipping-address';

const VALID = {
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: '3층',
};

describe('ShippingAddress.of', () => {
  it('유효한 값으로 만들어진다', () => {
    const address = ShippingAddress.of(VALID);
    expect(address.recipient).toBe('홍길동');
    expect(address.line2).toBe('3층');
  });

  it('line2는 없어도 된다', () => {
    expect(ShippingAddress.of({ ...VALID, line2: null }).line2).toBeNull();
  });

  it('빈 문자열 line2는 null이 된다', () => {
    // 저장할 때 ''와 null이 섞이면 조회 결과가 들쭉날쭉해진다.
    expect(ShippingAddress.of({ ...VALID, line2: '   ' }).line2).toBeNull();
  });

  it('앞뒤 공백을 다듬는다', () => {
    expect(ShippingAddress.of({ ...VALID, recipient: '  홍길동  ' }).recipient).toBe('홍길동');
  });

  it.each(['recipient', 'phone', 'zip', 'line1'] as const)(
    '%s가 비면 InvalidShippingAddressError다',
    (field) => {
      expect(() => ShippingAddress.of({ ...VALID, [field]: '   ' })).toThrow(
        InvalidShippingAddressError,
      );
    },
  );

  it('InvalidShippingAddressError는 DomainError다', () => {
    expect(new InvalidShippingAddressError('recipient')).toBeInstanceOf(DomainError);
  });
});

describe('ShippingAddress.fromPersistence', () => {
  it('저장된 값이 비면 CorruptedShippingAddressError다', () => {
    // 요청은 멀쩡했고 우리 데이터가 깨진 것이다. 400을 돌려주면 거짓말이다.
    expect(() => ShippingAddress.fromPersistence({ ...VALID, recipient: '' })).toThrow(
      CorruptedShippingAddressError,
    );
  });

  it('CorruptedShippingAddressError는 DomainError가 아니다', () => {
    expect(new CorruptedShippingAddressError('recipient')).not.toBeInstanceOf(DomainError);
  });
});
