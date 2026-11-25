"use client";
import { useActionState } from "react";
import type { FormState } from "@/app/actions";
import { ErrorNote } from "./ui";
import { Submit } from "./Submit";

/** Ввод факта по целям на дату сверки */
export function CheckinForm({
  action,
  date,
  goals,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  date: string;
  goals: { id: string; title: string; unit: string; last?: string }[];
}) {
  const [state, act] = useActionState(action, undefined);
  return (
    <form action={act} className="grid gap-4">
      <label className="grid max-w-56 gap-1.5">
        <span className="cap">Дата сверки</span>
        <input type="date" name="periodDate" defaultValue={date} className="field" required />
      </label>
      <div className="grid gap-3">
        {goals.map((g) => (
          <div key={g.id} className="grid items-end gap-2 md:grid-cols-[1fr_10rem_1fr]">
            <span className="text-head">
              {g.title}
              {g.last && <span className="cap block">прошлый факт: {g.last}</span>}
            </span>
            <label className="grid gap-1">
              <span className="cap">Факт{g.unit ? `, ${g.unit}` : ""}</span>
              <input name={`v_${g.id}`} inputMode="decimal" className="field" placeholder="число" />
            </label>
            <input name={`n_${g.id}`} className="field" placeholder="Комментарий: что повлияло" />
          </div>
        ))}
      </div>
      <ErrorNote text={state?.error} />
      <div className="flex items-center gap-3">
        <Submit>Сохранить факт</Submit>
        {state?.ok && <span className="cap">Сохранено</span>}
      </div>
    </form>
  );
}
