import { conversationModes, type ConversationMode } from 'protocol';
import { Field, Hint } from '../fields.tsx';

/** 会話を見るノード（エージェント・判定）の、会話の設定 */
type ConversationConfig = { conversation: ConversationMode; conversationLength: number };

/** ユーザーとの会話をどれだけ見せるか。直近なら往復の数をその横で選ぶ */
export function ConversationField(props: { config: ConversationConfig; onChange: (changed: Partial<ConversationConfig>) => void }) {
  const { config, onChange } = props;
  return (
    <Field label="ユーザーとの会話">
      <div className="flex flex-col items-start">
        <span className="flex items-center gap-1">
          <select
            className="min-w-0 flex-1"
            value={config.conversation}
            onChange={(e) => onChange({ conversation: e.target.value as ConversationMode })}
          >
            {conversationOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {config.conversation === 'recent' && (
            <>
              <input
                className="w-14"
                type="number"
                min={0}
                value={config.conversationLength}
                onChange={(e) => {
                  const conversationLength = Number(e.target.value);
                  if (Number.isInteger(conversationLength) && conversationLength >= 0) onChange({ conversationLength });
                }}
              />
              往復
            </>
          )}
        </span>
        <Hint>
          今回の発言と、その前のやりとりを見せます。含めないなら、ユーザーの言葉は見えず、前段から流れてきたものだけを受け取ります。
          フローから呼ばれたエージェントには前のやりとりを対話として、それ以外には会話の記録として渡します。
        </Hint>
      </div>
    </Field>
  );
}

const conversationLabels: Record<ConversationMode, string> = { none: '含めない', recent: '直近', all: 'すべて' };
const conversationOptions = conversationModes.map((value) => ({ value, label: conversationLabels[value] }));
