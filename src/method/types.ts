// Методика описывается как данные. Движок платформы не знает ничего про конкретную методику.

export type DecisionMode = "red" | "yellow" | "green";

export type FieldType = "text" | "longtext" | "enum" | "bool" | "number" | "date";

export interface FieldDef {
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Нужно ли подтверждать поле источником */
  evidence?: "none" | "recommended";
  /** Только одна запись в уровне может иметь true (например, «основной сегмент») */
  uniqueTrue?: boolean;
}

export interface Requirement {
  /** Сколько записей нужно минимум */
  min: number;
  /** Необязательный фильтр по значению поля, например {field: "kind", equals: "strength"} */
  where?: { field: string; equals: string };
  label: string;
}

export interface ManualVariant {
  label: string;
  preset: Record<string, string>;
}

export interface Section {
  key: string;
  title: string;
  description: string;
  /** Цвет светофора: кто решает на этом уровне */
  mode: DecisionMode;
  itemLabel: string;
  itemLabelPlural: string;
  fields: FieldDef[];
  /** Поле, которое служит названием записи */
  titleField: string;
  requirements: Requirement[];
  manualVariants?: ManualVariant[];
  /** Сколько записей ИИ предлагает за раз (для жёлтых и зелёных уровней) */
  draftLimit: number;
  /** Критерии качества для критики ИИ */
  rubric: string[];
}

export interface Stage {
  key: string;
  num: string;
  title: string;
  titleRu: string;
  frame: string;
  question: string;
  description: string;
  aiRole: string;
  humanRole: string;
  errorCost?: string;
  sections: Section[];
}

export interface Method {
  key: string;
  name: string;
  version: string;
  author: string;
  stages: Stage[];
}
