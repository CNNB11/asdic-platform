"use client";
import { useActionState } from "react";
import type { FormState } from "@/app/actions";
import type { PlanBrand } from "@/db/schema";
import { ErrorNote } from "./ui";
import { Submit } from "./Submit";

/** Оформление выгрузки: логотип, данные обложки, цвет и гриф NDA */
export function BrandForm({ action, brand, paid, logoUrl, ndaDefault }: { action: (s: FormState, fd: FormData) => Promise<FormState>; brand: PlanBrand; paid: boolean; logoUrl: string | null; ndaDefault: string }) {
  const [state, act] = useActionState(action, undefined);
  return (
    <form action={act} className="mt-4 grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-head">Логотип</span>
          <span className="cap">PNG, JPG или SVG до 2 МБ. Будет на обложке.</span>
          {logoUrl && (
            <span className="flex items-center gap-3 rounded-lg bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Логотип" className="max-h-12 max-w-48 object-contain" />
            </span>
          )}
          <input type="file" name="logo" accept="image/png,image/jpeg,image/svg+xml" className="field" />
          {logoUrl && (
            <span className="flex items-center gap-2 cap">
              <input type="checkbox" name="removeLogo" className="accent-white" /> Убрать логотип
            </span>
          )}
        </label>
        <label className="grid content-start gap-1.5">
          <span className="text-head">Цвет акцента</span>
          <span className="cap">Полоса на обложке, заголовки разделов и графики.</span>
          <input type="color" name="accent" defaultValue={brand.accent ?? "#141414"} className="h-10 w-24 cursor-pointer rounded border border-line bg-transparent" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-head">Название компании на обложке</span>
          <input name="companyName" defaultValue={brand.companyName ?? ""} className="field" placeholder="Например: ArtAutomation AG" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-head">Для кого подготовлено</span>
          <input name="preparedFor" defaultValue={brand.preparedFor ?? ""} className="field" placeholder="Совет директоров, инвестор, партнёр" />
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="text-head">Контакты на последней странице</span>
        <textarea name="contact" defaultValue={brand.contact ?? ""} className="field" rows={2} placeholder="Имя, должность, почта, телефон, сайт" />
      </label>
      <fieldset className={`card grid gap-3 p-4 ${paid ? "" : "opacity-60"}`} disabled={!paid}>
        <label className="flex items-center gap-2 text-head">
          <input type="checkbox" name="confidential" defaultChecked={!!brand.confidential} className="size-4 accent-white" /> Конфиденциально (NDA)
        </label>
        <span className="cap">
          {paid
            ? "Гриф «Конфиденциально» на обложке и каждой странице и уведомление о конфиденциальности в конце документа."
            : "Гриф NDA и документ без водяного знака и пометки платформы доступны на платных тарифах."}
        </span>
        <textarea name="ndaText" defaultValue={brand.ndaText ?? ""} className="field" rows={3} placeholder={ndaDefault} />
      </fieldset>
      <ErrorNote text={state?.error} />
      <div className="flex items-center gap-3">
        <Submit>Сохранить оформление</Submit>
        {state?.ok && <span className="cap">Сохранено. Соберите новую версию документа.</span>}
      </div>
    </form>
  );
}
