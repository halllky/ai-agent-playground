import { Hint } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/** ユーザー入力ノードの画面上の振る舞い */
export const userInputView: NodeKindView<'userInput'> = {
  label: 'ユーザー入力',
  fixed: true,
  summary: () => 'ターンの始まり',
  Inspector: () => (
    <Hint>
      ここからフローでつないだノードが、ターンの最初に動きます。発言そのものは流れず、エージェントと判定がそれぞれの「ユーザーとの会話」の設定で見ます。
    </Hint>
  ),
};

/** ユーザー出力ノードの画面上の振る舞い */
export const userOutputView: NodeKindView<'userOutput'> = {
  label: 'ユーザー出力',
  fixed: true,
  summary: () => '返答の送り先',
  Inspector: () => <Hint>ここへ流れ込んだものが返答になります。複数流れ込んだときは、送り元の名前で区切って並べます。</Hint>,
};
