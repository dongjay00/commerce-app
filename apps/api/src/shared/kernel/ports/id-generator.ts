/** 식별자 생성 포트. 테스트에서는 결정적 fake로 바꿔 끼운다. */
export interface IdGenerator {
  nextId(): string;
}

export const ID_GENERATOR = Symbol('IdGenerator');
