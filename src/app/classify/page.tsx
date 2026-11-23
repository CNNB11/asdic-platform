import type { Metadata } from "next";
import Link from "next/link";
import { ASDIC } from "@/method/asdic";
import { Classifier } from "@/components/Classifier";
import { Mark } from "@/components/Mark";
import { Asdic } from "@/components/ui";

export const metadata: Metadata = {
  title: "Светофор решений ASDIC™",
  description: "Четыре вопроса, чтобы понять, что можно поручить ИИ, а что решает человек.",
};

/** Бесплатный классификатор задач: открыт без входа */
export default function ClassifyPage() {
  const redList = ASDIC.stages.map((s) => ({ stage: s.title, items: s.sections.filter((x) => x.mode === "red").map((x) => x.title) })).filter((s) => s.items.length);
  return (
    <main className="mx-auto grid max-w-3xl gap-8 px-4 py-10">
      <Link href="/" className="flex items-center gap-3 text-head">
        <Mark size={32} />
        <span className="text-[22px]">
          <Asdic />
        </span>
      </Link>
      <div>
        <h1>Светофор решений</h1>
        <p className="prose-w mt-3">
          Что можно отдать ИИ, а что должен решать человек. Цвет зависит не от сложности задачи, а от цены ошибки, которую никто не заметил. Ответьте на четыре вопроса о своей задаче.
        </p>
      </div>
      <Classifier redList={redList} />
      <p className="cap">
        Правила светофора в методе <Asdic /> пока черновик и проверяются на живых проектах.
      </p>
    </main>
  );
}
