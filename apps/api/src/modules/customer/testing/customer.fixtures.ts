import type { AddressDetailsInput } from '../domain/address-details';

/** 테스트 전반에서 쓰는 고정값. 여러 파일이 같은 값을 다시 타이핑하지 않게 모아둔다. */
export const FIXED_NOW = new Date('2026-03-01T10:00:00.000Z');

export const HOME_ADDRESS: AddressDetailsInput = {
  label: '집',
  recipient: '홍길동',
  phone: '010-1234-5678',
  zip: '06236',
  line1: '서울시 강남구 테헤란로 1',
  line2: '101동',
};

export const OFFICE_ADDRESS: AddressDetailsInput = {
  label: '회사',
  recipient: '김철수',
  phone: '010-9876-5432',
  zip: '04524',
  line1: '서울시 중구 세종대로 110',
  line2: null,
};
