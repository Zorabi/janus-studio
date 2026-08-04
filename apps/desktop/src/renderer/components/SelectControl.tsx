import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
};

export function SelectControl({
  name,
  value,
  defaultValue = "",
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  className = "",
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: SelectOption[];
  onValueChange?: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 220,
    maxHeight: 320,
  });
  const selectedValue = value ?? internalValue;
  const selected =
    options.find((option) => option.value === selectedValue) ?? options[0];

  const select = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
    setOpen(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const measure = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const availableBelow = window.innerHeight - rect.bottom - 12;
    const availableAbove = rect.top - 12;
    const maxHeight = Math.min(340, Math.max(160, Math.max(availableBelow, availableAbove)));
    const useAbove = availableBelow < 220 && availableAbove > availableBelow;
    setPosition({
      left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 260) - 12),
      top: useAbove
        ? Math.max(12, rect.top - maxHeight - 8)
        : Math.min(window.innerHeight - maxHeight - 12, rect.bottom + 8),
      width: Math.max(rect.width, 260),
      maxHeight,
    });
  };

  useEffect(() => {
    if (!open) return;
    measure();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !(target instanceof Element && target.closest(`[data-select-list="${listId}"]`))
      ) {
        setOpen(false);
      }
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
  }, [listId, open]);

  useEffect(() => {
    const form = buttonRef.current?.closest("form");
    if (!form || value !== undefined) return;
    const reset = () => setInternalValue(defaultValue);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue, value]);

  const openList = () => {
    if (disabled) return;
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === selectedValue),
    );
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
      event.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (current + direction + options.length) % options.length;
      });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) select(option.value);
    }
  };

  return (
    <>
      {name && <input type="hidden" name={name} value={selectedValue} />}
      <button
        ref={buttonRef}
        type="button"
        className={`select-trigger ${open ? "is-open" : ""} ${className}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="select-trigger-copy">
          <strong>{selected?.label ?? selectedValue}</strong>
          {selected?.description && <small>{selected.description}</small>}
        </span>
        <ChevronDown size={16} />
      </button>
      {open &&
        createPortal(
          <div
            id={listId}
            data-select-list={listId}
            className="select-popover"
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            onKeyDown={onListKeyDown}
            ref={(element) => element?.focus()}
          >
            {options.map((option, index) => (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={option.value === selectedValue}
                className={[
                  "select-option",
                  option.value === selectedValue ? "is-selected" : "",
                  index === activeIndex ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => select(option.value)}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.value === selectedValue && <Check size={16} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
