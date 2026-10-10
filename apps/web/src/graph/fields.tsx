import { useId, type ReactNode } from 'react';
import type { ModelInfo } from 'protocol';
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

function describeModel(model: ModelInfo): string {
  const perMillion = (price: number) => (price * 1_000_000).toFixed(2);
  const price =
    model.pricing.prompt === 0 && model.pricing.completion === 0
      ? '無料'
      : `$${perMillion(model.pricing.prompt)} / $${perMillion(model.pricing.completion)} per 1M`;
  return `${model.supportsTools ? 'tools対応' : 'tools非対応'} · ${price} · ${Math.round(model.contextLength / 1000)}k`;
}
