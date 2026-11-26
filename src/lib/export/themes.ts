/** Темы оформления выгрузки. Все шрифты бесплатные (Google Fonts, OFL), с кириллицей. */
export type ThemeKey = "consulting" | "startup" | "premium" | "minimal";

export interface Theme {
  key: ThemeKey;
  label: string;
  hint: string;
  /** Акцент, если клиент не задал свой цвет и нет утверждённого фирменного стиля */
  accent: string;
  head: string;
  body: string;
}

export const THEMES: Theme[] = [
  { key: "consulting", label: "Строгий консалтинг", hint: "Засечки в заголовках, тёмно-синий, плотная сетка. Для совета директоров и банка.", accent: "#1f3a5f", head: "PT Serif", body: "Inter" },
  { key: "startup", label: "Современный стартап", hint: "Скруглённые карточки, яркий акцент, крупные цифры. Для инвестора и команды.", accent: "#5b4cf0", head: "Manrope", body: "Manrope" },
  { key: "premium", label: "Премиум", hint: "Тёмная обложка, золото, элегантные заголовки. Для партнёров и VIP-клиентов.", accent: "#b08d57", head: "Playfair Display", body: "Inter" },
  { key: "minimal", label: "Минимализм", hint: "Один шрифт, много воздуха, ничего лишнего. Фирменный вид ASDIC.", accent: "#141414", head: "SG", body: "SG" },
];

export const themeOf = (key: string | null | undefined): Theme => THEMES.find((t) => t.key === key) ?? THEMES[3];
