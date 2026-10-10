import { useId, type ReactNode } from 'react';
import { judgeQuestionTypes, type JudgeQuestion, type ModelInfo } from 'protocol';
import { useSession } from '../session/store.ts';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/** 1行または複数行のテキスト入力 */
export function TextField(props: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <Field label={props.label}>
      {props.multiline ? (
        <textarea rows={6} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </Field>
  );
}

/** 整数の入力。min 未満や整数でない入力は反映しない */
export function NumberField(props: { label: string; value: number; min: number; onChange: (value: number) => void }) {
  return (
    <Field label={props.label}>
      <input
        type="number"
        min={props.min}
        value={props.value}
        onChange={(e) => {
          const value = Number(e.target.value);
          if (Number.isInteger(value) && value >= props.min) props.onChange(value);
        }}
      />
    </Field>
  );
}

/** options から1つ選ぶ入力 */
export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={props.label}>
      <select value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** OpenRouter のモデル一覧から選ぶ。一覧にない ID も入力できる */
export function ModelField(props: { value: string; onChange: (value: string) => void }) {
  const listId = useId();
  const models = useSession((s) => s.models);
  const model = models?.find((m) => m.id === props.value);
  return (
    <Field label="モデル">
      <input list={listId} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      <datalist id={listId}>
        {models?.map((m) => (
          <option key={m.id} value={m.id}>
            {describeModel(m)}
          </option>
        ))}
      </datalist>
      {model && <span className="field-note">{describeModel(model)}</span>}
    </Field>
  );
}

type ResourceFile = { path: string; content: string };

/** リソースの JSON ファイル群の編集。パスや JSON の誤りはここでは検査しない */
export function ResourceFilesField(props: { files: ResourceFile[]; onChange: (files: ResourceFile[]) => void }) {
  const { files, onChange } = props;
  const update = (index: number, file: Partial<ResourceFile>) => onChange(files.map((f, i) => (i === index ? { ...f, ...file } : f)));
  return (
    <div className="resource-files">
      {files.map((file, i) => (
        <div key={i} className="resource-file">
          <div className="resource-file-header">
            <input value={file.path} placeholder="data.json" onChange={(e) => update(i, { path: e.target.value })} />
            <button type="button" className="danger" onClick={() => onChange(files.filter((_, j) => j !== i))}>
              削除
            </button>
          </div>
          <textarea rows={6} spellCheck={false} value={file.content} onChange={(e) => update(i, { content: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...files, { path: `data${files.length + 1}.json`, content: '{}' }])}>
        + ファイル
      </button>
    </div>
  );
}

/** 判定ノードの質問の編集。種類を変えると、その種類の選択肢・段階は空からやり直す */
export function JudgeQuestionsField(props: { questions: JudgeQuestion[]; onChange: (questions: JudgeQuestion[]) => void }) {
  const { questions, onChange } = props;
  const replace = (index: number, question: JudgeQuestion) => onChange(questions.map((q, i) => (i === index ? question : q)));
  return (
    <div className="judge-questions">
      {questions.map((question, i) => (
        <div key={i} className="judge-question">
          <div className="judge-question-header">
            <input value={question.key} placeholder="名前" onChange={(e) => replace(i, { ...question, key: e.target.value })} />
            <select value={question.type} onChange={(e) => replace(i, withType(question, e.target.value as JudgeQuestion['type']))}>
              {judgeQuestionTypes.map((type) => (
                <option key={type} value={type}>
                  {judgeQuestionTypeLabels[type]}
                </option>
              ))}
            </select>
            <button type="button" className="danger" onClick={() => onChange(questions.filter((_, j) => j !== i))}>
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

const judgeQuestionTypeLabels: Record<JudgeQuestion['type'], string> = { noul: 'はい/いいえ', choice: '選択', score: '段階評価' };

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
    <div className="list-editor">
      {items.map((item, i) => (
        <div key={i} className="list-editor-row">
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

function describeModel(model: ModelInfo): string {
  const perMillion = (price: number) => (price * 1_000_000).toFixed(2);
  const price =
    model.pricing.prompt === 0 && model.pricing.completion === 0
      ? '無料'
      : `$${perMillion(model.pricing.prompt)} / $${perMillion(model.pricing.completion)} per 1M`;
  return `${model.supportsTools ? 'tools対応' : 'tools非対応'} · ${price} · ${Math.round(model.contextLength / 1000)}k`;
}
