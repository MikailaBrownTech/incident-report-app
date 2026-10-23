"use client";

import { useId, useMemo, useState } from "react";
import { inputClass, labelClass } from "@/components/form";
import { useCopy } from "@/copy/provider";

export interface PickerService {
  id: string;
  name: string;
}

interface ServicePickerProps {
  services: PickerService[];
  selectedIds: string[];
  /** Names of services to create on submit (admins only). */
  newNames: string[];
  canCreate: boolean;
  onChange: (next: { selectedIds: string[]; newNames: string[] }) => void;
  error?: string | null;
}

/**
 * Multi-select combobox (ARIA 1.2 pattern): type to filter, arrows to move, Enter or click to toggle,
 * Escape to close. Admins also get a "Create ..." option for a name that doesn't exist yet.
 */
export function ServicePicker({ services, selectedIds, newNames, canCreate, onChange, error }: ServicePickerProps) {
  const t = useCopy();
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const trimmed = query.trim();
  const matches = useMemo(
    () => services.filter((s) => s.name.toLowerCase().includes(trimmed.toLowerCase())),
    [services, trimmed],
  );
  const exact = [...services.map((s) => s.name), ...newNames].some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const canOfferCreate = canCreate && trimmed.length > 0 && trimmed.length <= 60 && !exact;

  type Option = { kind: "service"; service: PickerService } | { kind: "create"; name: string };
  const options: Option[] = [
    ...matches.map((service) => ({ kind: "service", service }) as const),
    ...(canOfferCreate ? [{ kind: "create", name: trimmed } as const] : []),
  ];
  const safeActive = Math.min(active, Math.max(options.length - 1, 0));

  function toggle(option: Option) {
    if (option.kind === "create") {
      onChange({ selectedIds, newNames: [...newNames, option.name] });
      setQuery("");
      return;
    }
    const has = selectedIds.includes(option.service.id);
    onChange({
      selectedIds: has ? selectedIds.filter((x) => x !== option.service.id) : [...selectedIds, option.service.id],
      newNames,
    });
  }

  const chips = [
    ...selectedIds.map((sid) => ({ key: sid, name: services.find((s) => s.id === sid)?.name ?? sid, isNew: false })),
    ...newNames.map((name) => ({ key: `new:${name}`, name, isNew: true })),
  ];
  const listId = `${id}-list`;

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className={labelClass}>
        {t.declare.servicesLabel}
      </label>
      {chips.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="flex items-center gap-1 rounded-tag border border-border bg-surface py-0.5 pl-2.5 pr-1 text-sm"
            >
              <span>{chip.name}</span>
              <button
                type="button"
                aria-label={t.declare.removeService(chip.name)}
                className="rounded-tag px-1.5 text-muted hover:text-danger"
                onClick={() =>
                  onChange(
                    chip.isNew
                      ? { selectedIds, newNames: newNames.filter((n) => n !== chip.name) }
                      : { selectedIds: selectedIds.filter((x) => x !== chip.key), newNames },
                  )
                }
              >
                <span aria-hidden="true">{"×"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options.length > 0 ? `${id}-opt-${safeActive}` : undefined}
        aria-invalid={Boolean(error)}
        autoComplete="off"
        placeholder={t.declare.servicesPlaceholder}
        value={query}
        className={inputClass}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((safeActive + 1) % Math.max(options.length, 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((safeActive - 1 + options.length) % Math.max(options.length, 1));
          } else if (e.key === "Enter") {
            e.preventDefault(); // never submit the form from here
            if (open && options[safeActive]) toggle(options[safeActive]);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation(); // close the list, not the dialog
            setOpen(false);
          } else if (e.key === "Backspace" && query === "" && chips.length > 0) {
            const last = chips[chips.length - 1];
            onChange(
              last.isNew
                ? { selectedIds, newNames: newNames.slice(0, -1) }
                : { selectedIds: selectedIds.slice(0, -1), newNames },
            );
          }
        }}
      />
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={t.declare.servicesLabel}
          className="absolute inset-x-0 z-40 mt-1 max-h-48 overflow-auto rounded-pop border border-border bg-surface p-1 shadow-pop"
        >
          {options.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted">{t.declare.servicesNoMatch}</li>
          ) : null}
          {options.map((option, index) => {
            const selected = option.kind === "service" && selectedIds.includes(option.service.id);
            return (
              <li
                key={option.kind === "service" ? option.service.id : `create:${option.name}`}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={selected}
                className={`flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm ${
                  index === safeActive ? "bg-bg" : ""
                } ${option.kind === "create" ? "text-accent" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  toggle(option);
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span>{option.kind === "service" ? option.service.name : t.declare.createService(option.name)}</span>
                {selected ? <span aria-hidden="true">{"✓"}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
