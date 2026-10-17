import { useId, type ReactNode } from 'react';
import { defaultModelOf, modelProviderLabels, modelProviders, type ModelInfo, type ModelProvider } from 'protocol';
import { useStore } from '../store.ts';

/** インスペクタ内の小見出し */
export function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="mt-3 mb-1 text-sm font-bold">{children}</h4>;
}

/** 設定項目の補足説明 */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="my-3 text-muted">{children}</p>;
}

/** 1行または複数行のテキスト入力 */
export function TextField(props: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <Field label={props.label}>
      {props.multiline ? (
        <textarea
          rows={2}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="w-full field-sizing-content"
        />
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

/** オンかオフを選ぶ入力 */
export function CheckboxField(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="mb-2 flex items-center gap-1.5">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

/** options から複数選ぶ入力。values の並びは options の順にそろえる */
export function ChecklistField<T extends string>(props: {
  label: string;
  values: readonly T[];
  options: readonly { value: T; label: string }[];
  onChange: (values: T[]) => void;
}) {
  const toggle = (value: T, checked: boolean) =>
    props.onChange(props.options.map((o) => o.value).filter((v) => (v === value ? checked : props.values.includes(v))));
  return (
    <fieldset className="mb-2 flex flex-col gap-0.5">
      <legend className={`${fieldNote} mb-0.5`}>{props.label}</legend>
      {props.options.map((o) => (
        <label key={o.value} className="flex items-center gap-1.5">
          <input type="checkbox" checked={props.values.includes(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * プロバイダと、そのモデル一覧からモデルを選ぶ。一覧にない ID も入力できる。
 * モデル ID はプロバイダごとに別物なので、プロバイダを切り替えたら既定のモデルに戻す
 */
export function ProviderAndModelField(props: {
  provider: ModelProvider;
  model: string;
  onChange: (value: { provider: ModelProvider; model: string }) => void;
}) {
  const listId = useId();
  const models = useStore((s) => s.models[props.provider]);
  const error = useStore((s) => s.modelErrors[props.provider]);
  const model = models?.find((m) => m.id === props.model);
  return (
    <Field label="モデル">
      <div className="flex items-start min-w-0 flex-1 gap-0.5">
        <select
          value={props.provider}
          onChange={(e) => {
            const provider = e.target.value as ModelProvider;
            props.onChange({ provider, model: defaultModelOf[provider] });
          }}
        >
          {modelProviders.map((p) => (
            <option key={p} value={p}>
              {modelProviderLabels[p]}
            </option>
          ))}
        </select>
        <div className="flex-1 flex flex-col items-start">
          <input
            list={listId}
            value={props.model}
            onChange={(e) => props.onChange({ provider: props.provider, model: e.target.value })}
            className="min-w-0 self-stretch"
          />
          <datalist id={listId}>
            {models?.map((m) => (
              <option key={m.id} value={m.id}>
                {describeModel(m)}
              </option>
            ))}
          </datalist>
          {model && <span className={fieldNote}>{describeModel(model)}</span>}
          {error && <span className={fieldNote}>モデル一覧を取得できません: {error}</span>}
        </div>
      </div>
    </Field>
  );
}

/** 入力欄と、その見出し。見出しが空なら出さない（直前の小見出しが見出しを兼ねるとき） */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-2 flex items-start gap-0.5">
      <div className="basis-32 flex-none flex justify-end items-center py-1">
        <span className="text-xs text-muted select-none">
          {label}
        </span>
        &nbsp;
      </div>
      {children}
    </label>
  );
}

const fieldNote = 'text-xs text-muted';

function describeModel(model: ModelInfo): string {
  const perMillion = (price: number) => (price * 1_000_000).toFixed(2);
  const { pricing } = model;
  const price = !pricing
    ? '料金不明'
    : pricing.prompt === 0 && pricing.completion === 0
      ? '無料'
      : `$${perMillion(pricing.prompt)} / $${perMillion(pricing.completion)} per 1M`;
  return `${model.supportsTools ? 'tools対応' : 'tools非対応'} · ${price} · ${Math.round(model.contextLength / 1000)}k`;
}
