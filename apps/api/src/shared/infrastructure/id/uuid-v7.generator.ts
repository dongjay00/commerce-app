import { v7 as uuidv7 } from 'uuid';
import type { IdGenerator } from '../../kernel/ports/id-generator';

/**
 * UUID v7 생성기.
 * v7은 앞부분이 타임스탬프라 문자열 정렬 = 생성 순서가 되어 B-tree 인덱스에 친화적이다.
 */
export class UuidV7Generator implements IdGenerator {
  nextId(): string {
    return uuidv7();
  }
}
