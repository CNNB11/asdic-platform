"use client";
import { useActionState } from "react";
import type { FormState } from "@/app/actions";
import type { PlanBrand } from "@/db/schema";
import { ErrorNote } from "./ui";
import { Submit } from "./Submit";
import { THEMES } from "@/lib/export/themes";

/** Оформление выгрузки: логотип, данные обложки, цвет и гриф NDA */
export function BrandForm({ action, brand, paid, logoUrl, ndaDefault, hasBoard }: { action: (s: FormState, fd: FormData) => Promise<FormState>; brand: PlanBrand; paid: boolean; logoUrl: string | null; ndaDefault: string; hasBoard: boolean }) {
  const current = brand.theme ?? "minimal";
  const [state, act] = useActionState(action, undefined);
  return (
    <form action={act} className="mt-4 grid gap-4">
      <fieldset className="grid gap-2">
        <legend className="text-head">Тема оформления</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {THEMES.map((t) => (
            <label key={t.key} className="card flex cursor-pointer gap-3 p-3 has-[:checked]:border-head">
              <input type="radio" name="theme" value={t.key} defaultChecked={current === t.key} className="mt-1 accent-white" />
              <span className="grid gap-1">
                <span className="flex items-center gap-2 text-head">
                  <i className="inline-block size-3 rounded-full" style={{ background: t.accent === "#141414" ? "#f4f4f2" : t.accent }} />
                  {t.label}
                </span>
                <span className="cap">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex items-start gap-2 cap">
          <input type="checkbox" name="autoStyle" defaultChecked={brand.autoStyle !== false} className="mt-0.5 accent-white" />
          <span>
            Взять цвета и шрифты из фирменного стиля плана.{" "}
            {hasBoard ? "Утверждённый бренд-борд есть: документ будет в его цветах и шрифтах." : "Утверждённого бренд-борда пока нет, будут цвета темы."}
          </span>
        </label>
      </fieldset>
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
          <span className="cap">Полоса на обложке, заголовки разделов и графики. Без галочки цвет берётся из фирменного стиля или темы.</span>
          <span className="flex items-center gap-3">
            <input type="checkbox" name="customAccent" defaultChecked={!!brand.accent} className="size-4 accent-white" aria-label="Свой цвет" />
            <input type="color" name="accent" defaultValue={brand.accent ?? "#1f3a5f"} className="h-10 w-24 cursor-pointer rounded border border-line bg-transparent" />
            <span className="cap">свой цвет</span>
          </span>
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
