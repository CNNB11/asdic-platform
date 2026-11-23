import Link from "next/link";
import { itemOr404, requirePlan, sectionOr404 } from "@/lib/access";
import { saveItem } from "@/app/actions";
import { itemTitle } from "@/method";
import { ItemForm } from "@/components/ItemForm";
import { ModeChip } from "@/components/ui";

export default async function EditItemPage({ params }: PageProps<"/plans/[planId]/items/[itemId]/edit">) {
  const { planId, itemId } = await params;
  const { user, method } = await requirePlan(planId);
  const item = await itemOr404(planId, itemId);
  const { section } = sectionOr404(method, item.sectionKey);
  const href = `/plans/${planId}/items/${item.id}`;
  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href={href} className="cap link">
          ← {itemTitle(section, item.values)}
        </Link>
        <h1 className="mt-2">{section.mode === "red" ? "Проверка и подпись решения" : "Редактирование записи"}</h1>
        <div className="mt-2">
          <ModeChip mode={section.mode} />
        </div>
      </div>
      <ItemForm
        section={section}
        values={item.values}
        action={saveItem.bind(null, planId, section.key, item.id)}
        cancelHref={href}
        signerName={user.name}
        confirmedBy={item.decision?.confirmedBy}
      />
    </div>
  );
}
