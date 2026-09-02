import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@commerce/contracts'],
  // Next 16 generates AGENTS.md/CLAUDE.md on every `next dev` (not requested by the brief).
  agentRules: false,
};

export default config;
