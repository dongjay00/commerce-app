import { describe, expect, it } from 'vitest';
import { addressBodySchema, addressDtoSchema } from './address.contract';

const validBody = {
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울特別市 강남구 테헤란로 1',
  line2: '101동 1001호',
};

describe('addressBodySchema', () => {
  it('정상 입력을 파싱한다', () => {
    expect(addressBodySchema.parse(validBody)).toEqual(validBody);
  });

  it('line2는 생략할 수 있다', () => {
    const { line2: _omitted, ...withoutLine2 } = validBody;
    expect(addressBodySchema.parse(withoutLine2).line2).toBeUndefined();
  });

  it('빈 수취인을 거부한다', () => {
    expect(() => addressBodySchema.parse({ ...validBody, recipient: '' })).toThrow();
  });

  it('공백만 있는 수취인도 거부한다', () => {
    // .min(1)만으로는 ' '가 통과한다. 사용자가 스페이스 하나를 넣어 만든 주소는
    // 배송할 수 없는 주소다.
    expect(() => addressBodySchema.parse({ ...validBody, recipient: '   ' })).toThrow();
  });

  it('isDefault 같은 계약 밖 필드를 거부한다', () => {
    // 기본 배송지 지정은 전용 엔드포인트(setDefault)로만 한다. 생성/수정 본문으로
    // 받아들이면 "기본은 0 또는 1개" 불변식을 두 경로에서 지켜야 한다.
    expect(() => addressBodySchema.parse({ ...validBody, isDefault: true })).toThrow();
  });
});

describe('addressDtoSchema', () => {
  it('id와 isDefault를 포함한다', () => {
    const dto = {
      ...validBody,
      id: '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b',
      isDefault: true,
    };
    expect(addressDtoSchema.parse(dto)).toEqual(dto);
  });

  it('id가 uuid가 아니면 거부한다', () => {
    expect(() => addressDtoSchema.parse({ ...validBody, id: 'nope', isDefault: false })).toThrow();
  });

  it('추가 필드를 거부한다', () => {
    expect(() =>
      addressDtoSchema.parse({
        ...validBody,
        id: '018f2b1c-4a5d-7e6f-8a9b-0c1d2e3f4a5b',
        isDefault: false,
        customerId: '누출',
      }),
    ).toThrow();
  });
});
