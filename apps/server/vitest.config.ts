import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // テストファイル間で同じデータベースファイルを使うため、並行に開くとロックで失敗する
    fileParallelism: false,
    env: { DATABASE_PATH: join(tmpdir(), `ai-agent-playground-test-${process.pid}-${Date.now()}.db`) },
  },
});
