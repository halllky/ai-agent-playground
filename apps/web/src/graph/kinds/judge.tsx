import type { ReactNode } from 'react';
import { judgeQuestionTypeLabels, judgeQuestionTypes, type JudgeQuestion, type NodeOf } from 'protocol';
import { Hint, SectionHeading, TextField } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/** 判定ノードの画面上の振る舞い */
export const judgeView: NodeKindView<'judge'> = {
  label: '判定（Jev）',
  summary: (node) => `質問 ${node.config.questions.length} 件`,
  Inspector: ({ node, onChange }) => {
    const set = (config: Partial<NodeOf<'judge'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
    return (
      <>
        <TextField label="名前（ツール名）" value={node.config.name} onChange={(name) => set({ name })} />
        <TextField label="ツールの説明（呼び出し元に見える）" value={node.config.description} onChange={(description) => set({ description })} />
        <TextField label="モデル（空なら jev-latest）" value={node.config.model} onChange={(model) => set({ model })} />
        <SectionHeading>質問</SectionHeading>
        <Hint>入力された内容について、ここで決めた質問への回答を確率付きで返します。</Hint>
        <JudgeQuestionsField questions={node.config.questions} onChange={(questions) => set({ questions })} />
      </>
    );
  },
};

/** 判定ノードの質問の編集。種類を変えると、その種類の選択肢・段階は空からやり直す */
function JudgeQuestionsField(props: { questions: JudgeQuestion[]; onChange: (questions: JudgeQuestion[]) => void }) {
  const { questions, onChange } = props;
  const replace = (index: number, question: JudgeQuestion) => onChange(questions.map((q, i) => (i === index ? question : q)));
  return (
    <div className="mb-2 flex flex-col gap-2.5">
      {questions.map((question, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border p-1.5">
          <div className="flex gap-1">
            <input className="min-w-0 flex-1" value={question.key} placeholder="名前" onChange={(e) => replace(i, { ...question, key: e.target.value })} />
            <select value={question.type} onChange={(e) => replace(i, withType(question, e.target.value as JudgeQuestion['type']))}>
              {judgeQuestionTypes.map((type) => (
                <option key={type} value={type}>
                  {judgeQuestionTypeLabels[type]}
                </option>
              ))}
            </select>
            <button type="button" className="border-danger text-danger" onClick={() => onChange(questions.filter((_, j) => j !== i))}>
              削除
            </button>
          </div>
          <textarea rows={2} placeholder="質問文" value={question.instructions} onChange={(e) => replace(i, { ...question, instructions: e.target.value })} />
          <JudgeCriteriaField question={question} onChange={(q) => replace(i, q)} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...questions, withType({ key: `q${questions.length + 1}`, instructions: '' }, 'noul')])}>
        + 質問
      </button>
    </div>
  );
}

function JudgeCriteriaField({ question, onChange }: { question: JudgeQuestion; onChange: (question: JudgeQuestion) => void }) {
  switch (question.type) {
    case 'noul':
      return (
        <>
          <input placeholder="「はい」の意味（任意）" value={question.yes} onChange={(e) => onChange({ ...question, yes: e.target.value })} />
          <input placeholder="「いいえ」の意味（任意）" value={question.no} onChange={(e) => onChange({ ...question, no: e.target.value })} />
        </>
      );
    case 'choice':
      return (
        <ListEditor
          items={question.choices}
          newItem={() => ({ label: '', description: '' })}
          onChange={(choices) => onChange({ ...question, choices })}
          render={(choice, set) => (
            <>
              <input placeholder="ラベル" value={choice.label} onChange={(e) => set({ ...choice, label: e.target.value })} />
              <input placeholder="意味（任意）" value={choice.description} onChange={(e) => set({ ...choice, description: e.target.value })} />
            </>
          )}
        />
      );
    case 'score':
      return (
        <ListEditor
          items={question.levels}
          newItem={() => ''}
          onChange={(levels) => onChange({ ...question, levels })}
          render={(level, set, index) => (
            <input placeholder={`${index} 点の意味（任意）`} value={level} onChange={(e) => set(e.target.value)} />
          )}
        />
      );
  }
}

/** 項目の追加・削除ができる一覧 */
function ListEditor<T>(props: {
  items: T[];
  newItem: () => T;
  onChange: (items: T[]) => void;
  render: (item: T, set: (item: T) => void, index: number) => ReactNode;
}) {
  const { items, newItem, onChange, render } = props;
  return (
    <div className="flex flex-col gap-1">
      {items.map((item, i) => (
        <div key={i} className="flex gap-1 [&>input]:min-w-0 [&>input]:flex-1">
          {render(item, (changed) => onChange(items.map((x, j) => (j === i ? changed : x))), i)}
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, newItem()])}>
        + 追加
      </button>
    </div>
  );
}

function withType(question: Pick<JudgeQuestion, 'key' | 'instructions'>, type: JudgeQuestion['type']): JudgeQuestion {
  const { key, instructions } = question;
  switch (type) {
    case 'noul':
      return { key, instructions, type, yes: '', no: '' };
    case 'choice':
      return { key, instructions, type, choices: [] };
    case 'score':
      return { key, instructions, type, levels: [] };
  }
}
