import { describe, expect, it } from 'vitest';
import { OrderId } from '../kernel/identifiers';
import { SequentialIdGenerator } from './sequential-id-generator';

describe('SequentialIdGenerator', () => {
  it('호출할 때마다 다른 ID를 준다', () => {
    const ids = new SequentialIdGenerator();
    expect(ids.nextId()).not.toBe(ids.nextId());
  });

  it('생성 순서를 예측할 수 있다', () => {
    const ids = new SequentialIdGenerator();
    expect(ids.nextId()).toBe('00000000-0000-7000-8000-000000000001');
    expect(ids.nextId()).toBe('00000000-0000-7000-8000-000000000002');
  });

  it('식별자 VO가 받아들이는 UUID 형식이다', () => {
    const ids = new SequentialIdGenerator();
    expect(() => OrderId.of(ids.nextId())).not.toThrow();
  });

  it('prefix를 다르게 주면 서로 겹치지 않는다', () => {
    const orders = new SequentialIdGenerator('00000000-0000-7000-8000-');
    const skus = new SequentialIdGenerator('11111111-0000-7000-8000-');
    expect(orders.nextId()).not.toBe(skus.nextId());
  });

  it('reset하면 처음부터 다시 센다', () => {
    const ids = new SequentialIdGenerator();
    ids.nextId();
    ids.reset();
    expect(ids.nextId()).toBe('00000000-0000-7000-8000-000000000001');
  });
});
