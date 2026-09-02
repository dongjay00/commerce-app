import { describe, expect, it } from 'vitest';
import { PassthroughTransactionManager } from './passthrough-transaction-manager';

describe('PassthroughTransactionManager', () => {
  it('work를 실행하고 반환값을 그대로 전달한다', async () => {
    const manager = new PassthroughTransactionManager();
    await expect(manager.run(async () => 42)).resolves.toBe(42);
  });

  it('work에 트랜잭션 핸들을 넘긴다', async () => {
    const manager = new PassthroughTransactionManager();
    await manager.run(async (tx) => {
      expect(tx).toBeDefined();
      return null;
    });
  });

  it('work가 던진 예외를 그대로 전파한다', async () => {
    const manager = new PassthroughTransactionManager();
    await expect(
      manager.run(async () => {
        throw new Error('의도된 실패');
      }),
    ).rejects.toThrow('의도된 실패');
  });
});
