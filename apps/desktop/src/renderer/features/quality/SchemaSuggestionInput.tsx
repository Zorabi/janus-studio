import { Check, Search, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

const naturalCompare = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

function tokens(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function activeToken(value: string, multiple: boolean): string {
  if (!multiple) return value.trim();
  return value.split(",").at(-1)?.trim() ?? "";
}

export function filterSchemaSuggestions(value: string, options: string[], multiple = false): string[] {
  const query = activeToken(value, multiple).toLocaleLowerCase();
  const parts = value.split(",");
  const completed = multiple ? parts.slice(0, -1) : [];
  const selected = new Set(completed.map((item) => item.trim().toLocaleLowerCase()).filter(Boolean));
  return [...new Set(options)]
    .filter((option) => !selected.has(option.toLocaleLowerCase()))
    .filter((option) => !query || option.toLocaleLowerCase().includes(query))
    .sort(naturalCompare)
    .slice(0, 50);
}

export function applySchemaSuggestion(value: string, suggestion: string, multiple = false): string {
  if (!multiple) return suggestion;
  const parts = value.split(",");
  const completed = parts.slice(0, -1).map((item) => item.trim()).filter(Boolean);
  return [...new Set([...completed, suggestion])].join(", ");
}

export function removeSchemaToken(values: string[], token: string): string[] {
  return values.filter((value) => value !== token);
}

export function SchemaSuggestionInput({ value, options, onChange, ariaLabel, placeholder, emptyText, multiple = false, invalid = false }: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  emptyText: string;
  multiple?: boolean;
  invalid?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextFocusOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTokenIndex, setActiveTokenIndex] = useState<number | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 280, maxHeight: 300 });
  const committedSingle = !multiple && Boolean(value) && options.some((option) => option.toLocaleLowerCase() === value.toLocaleLowerCase());
  const selectedValues = useMemo(() => multiple ? tokens(value) : committedSingle ? [value] : [], [committedSingle, multiple, value]);
  const filterValue = multiple ? `${selectedValues.join(", ")}${selectedValues.length ? ", " : ""}${draft}` : committedSingle ? "" : value;
  const suggestions = useMemo(() => filterSchemaSuggestions(filterValue, options, multiple), [filterValue, multiple, options]);

  const measure = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const desiredHeight = Math.min(300, Math.max(62, suggestions.length * 42 + 12));
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const useAbove = below < Math.min(190, desiredHeight) && above > below;
    const maxHeight = Math.max(62, Math.min(desiredHeight, useAbove ? above : below));
    const width = Math.min(Math.max(rect.width, 320), Math.max(240, window.innerWidth - 24));
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: useAbove ? Math.max(12, rect.top - maxHeight - 7) : Math.min(window.innerHeight - maxHeight - 12, rect.bottom + 7),
      width,
      maxHeight,
    });
  };

  const publish = (values: string[]) => {
    const normalized = [...new Set(values.map((item) => item.trim()).filter(Boolean))];
    onChange(multiple ? normalized.join(", ") : normalized.at(-1) ?? "");
    setActiveTokenIndex(null);
  };

  useEffect(() => {
    if (!open) return;
    measure();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || (target instanceof Element && target.closest(`[data-schema-suggestions="${listId}"]`))) return;
      setOpen(false);
      if (multiple && draft.trim()) { publish([...selectedValues, draft]); setDraft(""); }
    };
    const reposition = () => measure();
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [draft, listId, multiple, open, selectedValues, suggestions.length]);

  useEffect(() => setActiveIndex(0), [filterValue, options]);
  useEffect(() => {
    if (activeTokenIndex !== null && activeTokenIndex >= selectedValues.length) setActiveTokenIndex(selectedValues.length ? selectedValues.length - 1 : null);
  }, [activeTokenIndex, selectedValues.length]);

  const commitDraft = () => {
    if (!draft.trim()) return;
    publish([...selectedValues, draft]);
    setDraft("");
  };
  const select = (suggestion: string) => {
    if (multiple) { publish([...selectedValues, suggestion]); setDraft(""); setOpen(true); }
    else { onChange(suggestion); setActiveTokenIndex(null); setOpen(false); skipNextFocusOpen.current = true; }
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus({ preventScroll:true });
      const end = input?.value.length ?? 0;
      input?.setSelectionRange(end, end);
    });
  };
  const removeToken = (token: string) => {
    publish(removeSchemaToken(selectedValues, token));
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll:true }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (activeTokenIndex !== null) {
      if (event.key === "ArrowLeft") { event.preventDefault(); setActiveTokenIndex(Math.max(0, activeTokenIndex - 1)); return; }
      if (event.key === "ArrowRight") { event.preventDefault(); setActiveTokenIndex(activeTokenIndex + 1 < selectedValues.length ? activeTokenIndex + 1 : null); return; }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        const token = selectedValues[activeTokenIndex];
        if (token) removeToken(token);
        return;
      }
      if (event.key.length === 1) setActiveTokenIndex(null);
    }
    const inputIsEmpty = multiple ? !draft : committedSingle || !value;
    if (event.key === "ArrowLeft" && inputIsEmpty && selectedValues.length) {
      event.preventDefault(); setActiveTokenIndex(selectedValues.length - 1); return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!suggestions.length) return;
      setActiveIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && suggestions[activeIndex]) select(suggestions[activeIndex]);
      else if (multiple) commitDraft();
      return;
    }
    if (multiple && event.key === ",") { event.preventDefault(); commitDraft(); return; }
    if (event.key === "Backspace" && inputIsEmpty && selectedValues.length) {
      event.preventDefault();
      const token = selectedValues[selectedValues.length - 1];
      if (token) removeToken(token);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  };

  return <div ref={rootRef} className={`schema-suggestion-input ${multiple ? "is-multiple" : ""} ${selectedValues.length ? "is-tokenized" : ""} ${invalid ? "is-invalid" : ""}`}>
    {selectedValues.map((item, index) => <span className={`schema-suggestion-chip ${activeTokenIndex === index ? "is-keyboard-active" : ""}`} key={item} onPointerDown={(event)=>{if((event.target as Element).closest("button"))return;event.preventDefault();setActiveTokenIndex(index);inputRef.current?.focus({preventScroll:true});}}>
      <span>{item}</span>
      <button
        type="button"
        aria-label={`${ariaLabel}: ${item}`}
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); removeToken(item); }}
      ><X size={13}/></button>
    </span>)}
    <input ref={inputRef} value={multiple ? draft : committedSingle ? "" : value} placeholder={!selectedValues.length ? placeholder : undefined}
      aria-label={ariaLabel} aria-invalid={invalid} aria-autocomplete="list" aria-controls={listId} aria-expanded={open} role="combobox"
      onFocus={() => { if(skipNextFocusOpen.current){skipNextFocusOpen.current=false;return;} measure(); setOpen(true); }}
      onChange={(event) => { setActiveTokenIndex(null); if (multiple) setDraft(event.target.value); else onChange(event.target.value); setOpen(true); }}
      onKeyDown={onKeyDown}/>
    <Search size={15}/>
    {open && createPortal(<div id={listId} data-schema-suggestions={listId} className="schema-suggestion-popover" role="listbox" aria-label={ariaLabel}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}>
      {suggestions.length ? suggestions.map((suggestion, index) => <button type="button" key={suggestion} role="option"
        aria-selected={index === activeIndex} className={index === activeIndex ? "is-active" : ""}
        onPointerEnter={() => setActiveIndex(index)} onClick={() => select(suggestion)}><span>{suggestion}</span>{selectedValues.includes(suggestion) && <Check size={15}/>}</button>)
        : <div className="schema-suggestion-empty">{emptyText}</div>}
    </div>, document.body)}
  </div>;
}
