import type { TokenStore, Tokens } from '../token-store';

export class InMemoryTokenStore implements TokenStore {
  readonly writes: Tokens[] = [];
  clearCalls = 0;

  constructor(private tokens: Tokens | null = null) {}

  async read(): Promise<Tokens | null> {
    return this.tokens;
  }

  async write(tokens: Tokens): Promise<void> {
    this.tokens = tokens;
    this.writes.push(tokens);
  }

  async clear(): Promise<void> {
    this.tokens = null;
    this.clearCalls += 1;
  }
}
