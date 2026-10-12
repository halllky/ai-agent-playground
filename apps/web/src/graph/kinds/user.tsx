import { Hint } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/** ユーザー入力ノードの画面上の振る舞い */
export const userInputView: NodeKindView<'userInput'> = {
  label: 'ユーザー入力',
  fixed: true,
  summary: () => '発言の送り元',
  Inspector: () => <Hint>ターンの発言はここから流れ出します。</Hint>,
};

/** ユーザー出力ノードの画面上の振る舞い */
export const userOutputView: NodeKindView<'userOutput'> = {
  label: 'ユーザー出力',
  fixed: true,
  summary: () => '返答の送り先',
  Inspector: () => <Hint>ここへ流れ込んだものが返答になります。複数流れ込んだときは、送り元の名前で区切って並べます。</Hint>,
};
