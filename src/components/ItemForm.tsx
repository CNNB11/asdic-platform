"use client";
import { useActionState } from "react";
import type { FormState } from "@/app/actions";
import type { Section } from "@/method";
import { ErrorNote, FormFields } from "./ui";
import { Submit } from "./Submit";

/** Форма записи. Для красного уровня кнопка = подпись решения человеком. */
export function ItemForm({
  section,
  values,
  action,
  cancelHref,
  hidden,
  signerName,
  confirmedBy,
}: {
  section: Section;
  values?: Record<string, unknown>;
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  cancelHref: string;
  hidden?: Record<string, string>;
  signerName: string;
  confirmedBy?: string;
}) {
  const [state, act] = useActionState(action, undefined);
  const red = section.mode === "red";
  return (
    <form action={act} className="grid gap-6">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <FormFields section={section} values={values} />
      {red && (
        <div className="card grid gap-3 border-red/60 p-4">
          <p className="text-head">Подпись решения</p>
          <p className="cap">
            Решение принимает и отвечает за него человек по имени. Подписывает: <span className="text-head">{signerName}</span>. Причину выбора запишите в поле «Обоснование»: к ней вернутся в Control.
          </p>
          <label className="grid gap-1.5">
            <span className="cap">Подтвердил второй человек (в маленькой команде это может быть заказчик), необязательно</span>
            <input name="confirmedBy" defaultValue={confirmedBy} className="field" placeholder="Имя и роль" />
          </label>
        </div>
      )}
      <ErrorNote text={state?.error} />
      <div className="flex flex-wrap gap-3">
        <Submit className={red ? "btn btn-red" : "btn btn-primary"}>{red ? "Подписать решение" : "Сохранить"}</Submit>
        <a href={cancelHref} className="btn btn-ghost">
          Отмена
        </a>
      </div>
      {!red && <p className="cap">Сохраняя запись, вы подтверждаете, что проверили её содержание.</p>}
    </form>
  );
}
