import { describe, expect, it } from 'vitest';
import { OrderId } from '../../kernel/identifiers';
import { UuidV7Generator } from './uuid-v7.generator';

describe('UuidV7Generator', () => {
  it('식별자 VO가 받아들이는 UUID 형식이다', () => {
    expect(() => OrderId.of(new UuidV7Generator().nextId())).not.toThrow();
  });

  it('버전 7이다', () => {
    // UUID의 13번째 hex 문자가 버전을 나타낸다: xxxxxxxx-xxxx-Vxxx-...
    expect(new UuidV7Generator().nextId()[14]).toBe('7');
  });

  it('나중에 만든 ID가 문자열 정렬에서 뒤에 온다 — 인덱스 친화적이어야 한다', async () => {
    const ids = new UuidV7Generator();
    const first = ids.nextId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = ids.nextId();
    expect(second > first).toBe(true);
  });

  it('연속 호출해도 중복되지 않는다', () => {
    const ids = new UuidV7Generator();
    const generated = new Set(Array.from({ length: 1000 }, () => ids.nextId()));
    expect(generated.size).toBe(1000);
  });
});
