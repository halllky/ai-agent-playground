import { Hint } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/** ユーザーノードの画面上の振る舞い */
export const userView: NodeKindView<'user'> = {
  label: 'ユーザー',
  summary: () => '発言の送り元・返答の送り先',
  Inspector: () => (
    <Hint>
      ターンの発言はここから流れ出し、ここへ流れ込んだものが返答になります。複数流れ込んだときは、送り元の名前で区切って並べます。
    </Hint>
  ),
};
