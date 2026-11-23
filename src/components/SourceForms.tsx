"use client";
import { useActionState, useRef } from "react";
import type { FormState } from "@/app/actions";
import { ErrorNote } from "./ui";
import { PendingNote, Submit } from "./Submit";

type Act = (s: FormState, fd: FormData) => Promise<FormState>;

export function UploadForm({ action }: { action: Act }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, act] = useActionState(async (s: FormState, fd: FormData) => {
    const r = await action(s, fd);
    if (!r?.error) ref.current?.reset();
    return r;
  }, undefined);
  return (
    <form ref={ref} action={act} className="card grid gap-4 p-5">
      <div>
        <h3>Загрузить файлы</h3>
        <p className="cap mt-1">PDF, DOCX, MD, TXT, CSV до 20 МБ. Исследования, интервью, отчёты, прайсы, отзывы клиентов. Сканы без текстового слоя пока не читаются.</p>
      </div>
      <input type="file" name="files" multiple accept=".pdf,.docx,.md,.txt,.csv" className="field file:mr-3 file:rounded file:border-0 file:bg-panel-2 file:px-3 file:py-1 file:text-head" />
      <ErrorNote text={state?.error} />
      <div>
        <Submit pending="Загружаю и читаю…">Загрузить</Submit>
        <PendingNote text="Текст извлекается, ИИ делает краткое описание каждого файла." />
      </div>
    </form>
  );
}

export function NoteForm({ action }: { action: Act }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, act] = useActionState(async (s: FormState, fd: FormData) => {
    const r = await action(s, fd);
    if (!r?.error) ref.current?.reset();
    return r;
  }, undefined);
  return (
    <form ref={ref} action={act} className="card grid gap-4 p-5">
      <div>
        <h3>Заметка или фрагмент страницы</h3>
        <p className="cap mt-1">Вставьте текст: выдержку из статьи, итоги разговора с клиентом, данные из CRM. Ссылка необязательна.</p>
      </div>
      <input name="title" className="field" placeholder="Название" required />
      <input name="url" className="field" placeholder="https://… (необязательно)" />
      <textarea name="text" rows={6} className="field" placeholder="Текст" required />
      <ErrorNote text={state?.error} />
      <div>
        <Submit>Добавить</Submit>
      </div>
    </form>
  );
}
