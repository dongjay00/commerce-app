import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/domain-error';
import { AddressDetails } from './address-details';
import { InvalidAddressError } from './customer.errors';

// vitest 3.2.7의 toThrow 타입(Constructable = new (...args: any[]) => any)은 concrete
// 생성자만 받는다. DomainError는 abstract라 그대로 넘기면 tsc가 거부한다(identifiers.spec.ts
// 참고). 런타임 동작은 abstract 여부와 무관하므로 타입 단계에서만 unknown을 거쳐 우회한다.
const DomainErrorConstructor = DomainError as unknown as new (...args: never[]) => Error;

const VALID = {
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: '101동 1001호',
};

describe('AddressDetails', () => {
  it('정상 입력을 만든다', () => {
    const details = AddressDetails.of(VALID);
    expect(details.recipient).toBe('홍길동');
    expect(details.line2).toBe('101동 1001호');
  });

  it('line2를 생략하면 null이 된다', () => {
    const { line2: _omitted, ...rest } = VALID;
    expect(AddressDetails.of(rest).line2).toBeNull();
  });

  it('빈 line2도 null로 정규화한다', () => {
    // ''와 null이 섞이면 "같은 주소인가" 비교가 조용히 어긋난다.
    expect(AddressDetails.of({ ...VALID, line2: '' }).line2).toBeNull();
    expect(AddressDetails.of({ ...VALID, line2: '   ' }).line2).toBeNull();
  });

  it('필수 항목의 앞뒤 공백을 제거한다', () => {
    expect(AddressDetails.of({ ...VALID, recipient: '  홍길동  ' }).recipient).toBe('홍길동');
  });

  it.each(['label', 'recipient', 'phone', 'zip', 'line1'] as const)(
    '%s가 비어 있으면 거부한다',
    (field) => {
      expect(() => AddressDetails.of({ ...VALID, [field]: '' })).toThrow(InvalidAddressError);
    },
  );

  it.each(['label', 'recipient', 'phone', 'zip', 'line1'] as const)(
    '%s가 공백뿐이면 거부한다',
    (field) => {
      expect(() => AddressDetails.of({ ...VALID, [field]: '   ' })).toThrow(InvalidAddressError);
    },
  );

  it('실패는 DomainError다', () => {
    expect(() => AddressDetails.of({ ...VALID, zip: '' })).toThrow(DomainErrorConstructor);
  });

  it('모든 필드가 같으면 equals가 참이다', () => {
    expect(AddressDetails.of(VALID).equals(AddressDetails.of(VALID))).toBe(true);
  });

  it('한 필드라도 다르면 equals가 거짓이다', () => {
    expect(AddressDetails.of(VALID).equals(AddressDetails.of({ ...VALID, zip: '00000' }))).toBe(
      false,
    );
  });

  it('line2가 null인 것과 값이 있는 것은 다르다', () => {
    const { line2: _omitted, ...rest } = VALID;
    expect(AddressDetails.of(VALID).equals(AddressDetails.of(rest))).toBe(false);
  });
});
