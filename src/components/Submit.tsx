"use client";
import { useFormStatus } from "react-dom";

/** Кнопка отправки формы с состоянием ожидания (для долгих операций ИИ) */
export function Submit({ children, pending, className = "btn btn-primary", name, value }: { children: React.ReactNode; pending?: string; className?: string; name?: string; value?: string }) {
  const { pending: p } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={p} name={name} value={value}>
      {p ? (pending ?? "Сохраняю…") : children}
    </button>
  );
}

export function PendingNote({ text }: { text: string }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return <p className="cap mt-2 animate-pulse">{text}</p>;
}
