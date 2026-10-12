import { accessPermissions, judgeAnswerOptions, type AccessPermission, type FlowCondition, type NodeOf } from 'protocol';
import { ChecklistField, Hint, SelectField } from '../fields.tsx';
import type { EdgeKindView } from './index.ts';

/** ツールエッジの画面上の振る舞い。権限は送り先がフォルダのときだけ表示・編集する */
export const toolEdgeView: EdgeKindView<'tool'> = {
  label: (edge, { target }) => (target?.kind === 'files' ? permissionLabels[edge.permission] : ''),
  Inspector: ({ edge, target, onChange }) =>
    target?.kind === 'files' ? (
      <SelectField
        label="このフォルダ以下への権限"
        value={edge.permission}
        options={permissionOptions}
        onChange={(permission) => onChange({ ...edge, permission })}
      />
    ) : (
      <Hint>送り元のエージェントが、送り先をツールとして使えるようにします。呼び出され方は送り先のノードで決まります。</Hint>
    ),
};

/** フローエッジの画面上の振る舞い。条件は送り元が判定ノードのときだけ編集できる。何も返さないエージェントからは、受け取った入力がそのまま流れる */
export const flowEdgeView: EdgeKindView<'flow'> = {
  label: (edge) => (edge.condition ? `${edge.condition.questionKey}: ${edge.condition.anyOf.join(' / ')}` : ''),
  Inspector: ({ edge, source, onChange }) => (
    <>
      <Hint>
        送り元の出力を、送り先の入力として流します。ユーザーから流れをたどれるノードが、流れの順に1回ずつ実行されます。
        何も流れてこなかったノードは実行しません。返すものが「なし」のエージェントからは、そのエージェントが受け取った入力がそのまま流れます。
      </Hint>
      {source?.kind === 'judge' && (
        <FlowConditionFields questions={source.config.questions} condition={edge.condition} onChange={(condition) => onChange({ ...edge, condition })} />
      )}
    </>
  ),
};

const permissionLabels: Record<AccessPermission, string> = { read: '参照', write: '編集' };
const permissionOptions = accessPermissions.map((value) => ({ value, label: permissionLabels[value] }));

/** 判定ノードから出るフローの条件。質問を選ぶと、まずその質問の最初の回答だけを流す条件にする */
function FlowConditionFields(props: {
  questions: NodeOf<'judge'>['config']['questions'];
  condition: FlowCondition | null;
  onChange: (condition: FlowCondition | null) => void;
}) {
  const { questions, condition, onChange } = props;
  const always = '__always__';
  const question = condition && questions.find((q) => q.key === condition.questionKey);
  const questionOptions = [{ value: always, label: '常に流す' }, ...questions.map((q) => ({ value: q.key, label: q.key }))];
  const selectQuestion = (key: string) => {
    const selected = questions.find((q) => q.key === key);
    onChange(selected ? { questionKey: key, anyOf: judgeAnswerOptions(selected).slice(0, 1).map((o) => o.value) } : null);
  };
  return (
    <>
      <SelectField label="流す条件" value={condition?.questionKey ?? always} options={questionOptions} onChange={selectQuestion} />
      {condition && question && (
        <ChecklistField
          label="この回答のときだけ流す"
          options={judgeAnswerOptions(question)}
          values={condition.anyOf}
          onChange={(anyOf) => onChange({ ...condition, anyOf })}
        />
      )}
    </>
  );
}
