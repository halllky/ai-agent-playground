import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { DATABASE_PATH: join(tmpdir(), `ai-agent-playground-test-${process.pid}-${Date.now()}.db`) },
  },
});
