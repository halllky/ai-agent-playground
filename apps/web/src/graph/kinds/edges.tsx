import {
  accessPermissions,
  judgeAnswerOptions,
  replaceEdge,
  replaceNode,
  scopeLabel,
  scopeOf,
  type AccessPermission,
  type CallMemoryMode,
  type EdgeOf,
  type FlowCondition,
  type GraphDefinition,
  type NodeOf,
  type ReturnMode,
} from 'protocol';
import { CheckboxField, ChecklistField, Hint, SelectField, TextField } from '../fields.tsx';
import type { EdgeKindView } from './index.ts';

/** ツールエッジの画面上の振る舞い。送り先がエージェントなら、返すものと依頼と応答の記憶もここで決める */
export const toolEdgeView: EdgeKindView<'tool'> = {
  label: (edge, { target }) => (target?.kind !== 'agent' ? '' : target.config.workOnly ? '完了のみ' : returnsLabels[edge.returns]),
  Inspector: ({ edge, target, onChange, onGraphChange }) => (
    <>
      <Hint>送り元のエージェントが、送り先をツールとして使えるようにします。送り元が呼び出すときに書く指示が、送り先への依頼になります。</Hint>
      <TextField
        label="ツールの説明（送り元のエージェントに見える）"
        multiline
        value={edge.description}
        onChange={(description) => onChange({ ...edge, description })}
      />
      {target && target.kind !== 'agent' && <Hint>空なら既定の説明を使います。</Hint>}
      {target?.kind === 'agent' && (
        <>
          <ReturnsField
            label="呼び出し元へ返すもの"
            workOnlyLabel="なし（作業だけして終わる。完了したことだけを返す）"
            edge={edge}
            agent={target}
            onGraphChange={onGraphChange}
          />
          <MemoryField modes={['none', 'turn', 'session']} value={edge.memory} onChange={(memory) => onChange({ ...edge, memory })} />
        </>
      )}
    </>
  ),
};

/** アクセスエッジの画面上の振る舞い。範囲はキャンバスでつないだ行で決まり、ここでは権限とプロンプトに含めるかを変える */
export const accessEdgeView: EdgeKindView<'access'> = {
  label: (edge) => {
    if (!edge.attach) return permissionLabels[edge.permission];
    return edge.permission === 'none' ? attachLabel : `${permissionLabels[edge.permission]}・${attachLabel}`;
  },
  Inspector: ({ edge, target, onChange }) => {
    const scope = target?.kind === 'workfolder' ? scopeOf(target, edge.entryId) : null;
    return (
      <>
        <Hint>
          送り元のエージェントに、ワークフォルダの {scope ? scopeLabel(scope) : '（もう無いファイル・フォルダ）'} への権限を与えます。
          「{attachLabel}」をオンにすると、呼び出しのたびにその時点の中身をプロンプトに入れます。
        </Hint>
        <SelectField label="権限" value={edge.permission} options={permissionOptions} onChange={(permission) => onChange({ ...edge, permission })} />
        <CheckboxField label={attachLabel} checked={edge.attach} onChange={(attach) => onChange({ ...edge, attach })} />
        {scope?.isFolder && <Hint>その時点でこの中にあるファイルをすべて含めます。</Hint>}
      </>
    );
  },
};

/**
 * フローエッジの画面上の振る舞い。送り元がエージェントなら流すもの、判定ノードなら条件、送り先がエージェントなら依頼と応答の記憶を決める。
 * 記憶は送り先へ入るフローエッジでそろえる（フローからは1ターンに1回しか呼ばれないので、記憶はフローからの呼び出しで1つ）
 */
export const flowEdgeView: EdgeKindView<'flow'> = {
  label: (edge, { source }) => {
    const condition = edge.condition ? `${edge.condition.questionKey}: ${edge.condition.anyOf.join(' / ')}` : '';
    const returns = source?.kind !== 'agent' ? '' : source.config.workOnly ? `${source.config.name} の入力をそのまま` : returnsLabels[edge.returns];
    return [condition, returns].filter(Boolean).join(' · ');
  },
  Inspector: ({ edge, source, target, onChange, onGraphChange }) => (
    <>
      <Hint>送り元の出力を、送り先の入力として流します。ユーザーから流れをたどれるノードが、流れの順に1回ずつ実行されます。何も流れてこなかったノードは実行しません。</Hint>
      {target?.kind === 'agent' && <Hint>流れてきたものが、送り先のエージェントへの依頼になります。</Hint>}
      {source?.kind === 'agent' && (
        <ReturnsField
          label="送り元が流すもの"
          workOnlyLabel="受け取った入力をそのまま（作業だけして終わる）"
          edge={edge}
          agent={source}
          onGraphChange={onGraphChange}
        />
      )}
      {source?.kind === 'judge' && (
        <FlowConditionFields questions={source.config.questions} condition={edge.condition} onChange={(condition) => onChange({ ...edge, condition })} />
      )}
      {target?.kind === 'agent' && (
        <MemoryField
          modes={['none', 'session']}
          value={edge.memory === 'session' ? 'session' : 'none'}
          onChange={(memory) => onGraphChange((graph) => withFlowMemory(graph, target.id, memory))}
        />
      )}
    </>
  ),
};

const returnsLabels: Record<ReturnMode, string> = { finalText: '', allSteps: '全ステップ' };
const permissionLabels: Record<AccessPermission, string> = { none: 'なし', read: '参照', write: '編集' };
const permissionOptions = accessPermissions.map((value) => ({ value, label: permissionLabels[value] }));
const attachLabel = 'プロンプトに含める';

/**
 * エージェントからエッジの先へ返すもの。作業だけして終わるかはエージェントの設定なので、選ぶとそのエージェントのほかのエッジにも効く。
 * 最後の応答文か全ステップを選ぶと、作業だけして終わるのをやめ、このエッジの returns を変える
 */
function ReturnsField(props: {
  label: string;
  workOnlyLabel: string;
  edge: EdgeOf<'tool'> | EdgeOf<'flow'>;
  agent: NodeOf<'agent'>;
  onGraphChange: (update: (graph: GraphDefinition) => GraphDefinition) => void;
}) {
  const { edge, agent, onGraphChange } = props;
  const options = [
    { value: 'finalText', label: '最後の応答文' },
    { value: 'allSteps', label: '全ステップ（JSON）' },
    { value: 'workOnly', label: props.workOnlyLabel },
  ] as const;
  const select = (value: ReturnMode | 'workOnly') =>
    onGraphChange((graph) => {
      const workOnly = value === 'workOnly';
      const withAgent = replaceNode(graph, { ...agent, config: { ...agent.config, workOnly } });
      return workOnly ? withAgent : replaceEdge(withAgent, { ...edge, returns: value });
    });
  return (
    <>
      <SelectField label={props.label} value={agent.config.workOnly ? 'workOnly' : edge.returns} options={options} onChange={select} />
      {agent.config.workOnly && <Hint>このエージェントのほかのエッジもすべて、作業だけして終わる扱いになります。</Hint>}
    </>
  );
}

/** 送り先のエージェントへの、これまでの依頼と応答を含めるか。modes は選べる範囲 */
function MemoryField<T extends CallMemoryMode>(props: { modes: T[]; value: T; onChange: (memory: T) => void }) {
  return (
    <>
      <SelectField
        label="これまでの依頼と応答を含める"
        value={props.value}
        options={props.modes.map((value) => ({ value, label: memoryLabels[value] }))}
        onChange={props.onChange}
      />
      <Hint>この呼び出し元からの依頼と、それへの応答（ツールの呼び出しと結果を含む）を、次の呼び出しのときに会話の続きとして渡します。</Hint>
    </>
  );
}

const memoryLabels: Record<CallMemoryMode, string> = { none: '含めない', turn: 'このターンの分', session: 'このセッションの分' };

/** nodeId のノードへ入るフローエッジの記憶を、すべて memory にそろえたグラフ */
function withFlowMemory(graph: GraphDefinition, nodeId: string, memory: CallMemoryMode): GraphDefinition {
  return { ...graph, edges: graph.edges.map((e) => (e.kind === 'flow' && e.target === nodeId ? { ...e, memory } : e)) };
}

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
