"use client";

import { useId, useState } from "react";
import { inputClass, labelClass, primaryButton, secondaryButton } from "@/components/form";
import { useCopy } from "@/copy/provider";
import type { PersonView } from "@/features/incidents/schema";
import type { ActionItemView } from "@/features/action-items/schema";
import type { ItemsPayload } from "@/features/action-items/schema";
import { addDays, localDay } from "@/features/action-items/state";
import { api } from "@/lib/api-client";

type Due = "none" | "week" | "twoWeeks" | "month" | "custom";
const OFFSETS: Record<"week" | "twoWeeks" | "month", number> = { week: 7, twoWeeks: 14, month: 30 };

interface Props {
  slug: string;
  incidentNumber: number;
  members: PersonView[];
  currentUserId: string;
  onCreated: (item: ActionItemView, people: ItemsPayload["people"]) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/** Title, owner (defaults to me), due date (quick picks or a date) and an optional description. */
export function AddItemForm({ slug, incidentNumber, members, currentUserId, onCreated, onCancel, autoFocus }: Props) {
  const t = useCopy();
  const r = t.ritual;
  const id = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [due, setDue] = useState<Due>("none");
  const [custom, setCustom] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dueDate = (): string | null => {
    if (due === "none") return null;
    if (due === "custom") return custom || null;
    return addDays(localDay(), OFFSETS[due]);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError(t.validation.required);
      return;
    }
    setPending(true);
    setError(null);
    const result = await api<ItemsPayload>(`/api/w/${slug}/incidents/${incidentNumber}/action-items`, {
      method: "POST",
      body: { title: title.trim(), description: description.trim(), ownerId, dueDate: dueDate() },
    });
    setPending(false);
    if (!result.ok) {
      setError(
        result.code === "no_postmortem"
          ? r.noPostmortem
          : result.fieldErrors?.ownerId
            ? r.notAMember
            : result.fieldErrors?.title
              ? t.validation.required
              : r.toasts.saveFailed,
      );
      return;
    }
    onCreated(result.data.items[0], result.data.people);
    setTitle("");
    setDescription("");
    setDue("none");
    setCustom("");
  }

  const pick = (key: Due, label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={due === key}
      onClick={() => setDue(key)}
      className={`rounded-tag border px-3 py-1 text-sm ${due === key ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface hover:border-accent"}`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={r.add}>
      <div>
        <label htmlFor={`${id}-title`} className={labelClass}>
          {r.fields.title}
        </label>
        <input
          id={`${id}-title`}
          value={title}
          maxLength={200}
          autoFocus={autoFocus}
          placeholder={r.placeholders.title}
          aria-invalid={Boolean(error) && !title.trim()}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-owner`} className={labelClass}>
          {r.fields.owner}
        </label>
        <select id={`${id}-owner`} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass}>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name || m.email}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className={labelClass}>{r.fields.dueDate}</legend>
        <div className="flex flex-wrap gap-2">
          {pick("week", r.quickDue.week)}
          {pick("twoWeeks", r.quickDue.twoWeeks)}
          {pick("month", r.quickDue.month)}
          {pick("custom", r.quickDue.custom)}
          {pick("none", r.quickDue.none)}
        </div>
        {due === "custom" && (
          <input
            type="date"
            aria-label={r.fields.dueDate}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className={`${inputClass} mt-2`}
          />
        )}
      </fieldset>
      <div>
        <label htmlFor={`${id}-desc`} className={labelClass}>
          {r.fields.description}
        </label>
        <textarea
          id={`${id}-desc`}
          rows={2}
          value={description}
          maxLength={5000}
          placeholder={r.placeholders.description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={pending}>
          {pending ? r.adding : r.add}
        </button>
        {onCancel && (
          <button type="button" className={secondaryButton} onClick={onCancel} disabled={pending}>
            {t.actions.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
