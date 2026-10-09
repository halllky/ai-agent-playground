# AIエージェント実験場

メインエージェント、サブエージェント、関連リソースをどう組み替えたら
全体としてどういう挙動になるかを頻繁に組み替えながら実験するためのリポジトリ。

ユースケース単位で単一のエージェントを提供するサービスはたくさんあるが、
内側のサブエージェントを細かく操作できるものがなかなかないので独自に構築している。

## 開発・デバッグ

### 準備

- Node.js 22 以上が必要（nvm-windows なら `nvm use 24.21.0`）。
- `npm install`
- `apps/server/.env.example` を `apps/server/.env` にコピーし、`OPENROUTER_API_KEY` を設定する。

### 起動

- `npm run dev` でサーバー（http://localhost:8787）と画面（http://localhost:5173）が同時に起動する。
  画面からの `/api` はサーバーへ転送される。
- ブレークポイントを使うときは、VS Code で `ai-agent-playground.code-workspace` を開き、
  「実行とデバッグ」から「デバッグ」を起動する。JavaScript Debug Terminal で `npm run dev` が動くので、
  `apps/server/src` の TypeScript にそのままブレークポイントを置ける。
  画面側はブラウザの開発者ツールでデバッグする。

### 挙動の確認

- 画面下のログパネル
  - 「イベント」タブ：エージェント呼び出し・ツールコール・ステップのイベントが時系列に並ぶ。
    行をクリックすると全文が開き、`step.finish` には LLM への生のリクエスト（システムプロンプト・履歴・ツール定義）とレスポンスが入っている。
  - 「集計」タブ：ターン別・ノード別のトークン数・コスト・所要時間。
- サーバーのコンソールには HTTP のアクセスログと、LLM 呼び出しのエラーが出る。
- ターンのイベントは `GET /api/turns/<turnId>/events`（SSE）で、保存済みのものから再生して取得できる。

### データ

- グラフ構成・セッション・ログはすべて `apps/server/data/playground.db`（SQLite）に保存される。
  場所は `.env` の `DATABASE_PATH` で変えられる。
- まっさらな状態に戻すには、サーバーを止めて `apps/server/data` を削除する。
- 実行中にサーバーを止めたターンは、次の起動時にエラー終了として閉じられる。
- テーブル定義を変えたら `npm run db:generate -w server` でマイグレーションを生成する。
  マイグレーションはサーバー起動時に自動で適用される。

### API キーなしで試す

`.env` の `OPENROUTER_BASE_URL` に OpenAI 互換の Chat Completions API（ストリーミング対応）を返すサーバーを指定すると、
OpenRouter の代わりにそちらへリクエストが送られる。

### テスト・型チェック

- `npm test`：実行エンジンのテスト。LLM はモックで、データベースは一時ファイルを使うので、API キーも既存データも不要。
- `npm run typecheck`：全パッケージの型チェック。
