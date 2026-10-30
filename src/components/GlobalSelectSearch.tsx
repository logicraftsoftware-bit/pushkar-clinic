import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckSquare, Search, Square, X } from "lucide-react";
import "./global-select-search.css";

type OpenSelect = { element: HTMLSelectElement; rect: DOMRect };

export default function GlobalSelectSearch() {
  const [open, setOpen] = useState<OpenSelect | null>(null);
  const [query, setQuery] = useState("");
  const [, refresh] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function show(element: HTMLSelectElement) {
      if (element.disabled || element.dataset.nativeSelect === "true") return;
      setOpen({ element, rect: element.getBoundingClientRect() });
      setQuery("");
    }
    function pointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest(".global-select-popover")) return;
      const element = target?.closest("select");
      if (!(element instanceof HTMLSelectElement) || element.disabled) {
        setOpen(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      show(element);
    }
    function keyDown(event: KeyboardEvent) {
      const element = event.target;
      if (
        element instanceof HTMLSelectElement &&
        ["Enter", " ", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        show(element);
      }
      if (event.key === "Escape") setOpen(null);
    }
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("keydown", keyDown, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("keydown", keyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const close = () => setOpen(null);
    const closeOnExternalScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".global-select-popover")) return;
      close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", closeOnExternalScroll, true);
    window.addEventListener("popstate", close);
    window.addEventListener("hashchange", close);
    const observer = new MutationObserver(() => {
      if (!document.body.contains(open.element)) close();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOnExternalScroll, true);
      window.removeEventListener("popstate", close);
      window.removeEventListener("hashchange", close);
      observer.disconnect();
    };
  }, [open]);

  const options = useMemo(
    () =>
      open
        ? Array.from(open.element.options).filter((option) =>
            option.text.toLowerCase().includes(query.trim().toLowerCase()),
          )
        : [],
    [open, query],
  );
  if (!open || !document.body.contains(open.element)) return null;

  const { element, rect } = open;
  const popupHeight = Math.min(360, 94 + options.length * 38);
  const roomBelow = window.innerHeight - rect.bottom;
  const top =
    roomBelow >= Math.min(popupHeight, 240)
      ? rect.bottom + 5
      : Math.max(8, rect.top - popupHeight - 5);
  const left = Math.min(
    rect.left,
    window.innerWidth - Math.max(rect.width, 260) - 8,
  );
  const notify = () => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    refresh((value) => value + 1);
  };
  function choose(option: HTMLOptionElement) {
    if (option.disabled) return;
    if (element.multiple) {
      option.selected = !option.selected;
      notify();
    } else {
      element.value = option.value;
      notify();
      setOpen(null);
      element.focus();
    }
  }
  function selectAll() {
    const enabled = Array.from(element.options).filter(
      (option) => !option.disabled && option.value !== "",
    );
    const shouldSelect = enabled.some((option) => !option.selected);
    enabled.forEach((option) => {
      option.selected = shouldSelect;
    });
    notify();
  }

  return (
    <div
      className="global-select-popover"
      style={{ top, left, width: Math.max(rect.width, 260) }}
      onPointerDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="Search dropdown options"
    >
      <div className="global-select-search">
        <Search />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search options..."
        />
        <button type="button" onClick={() => setOpen(null)} aria-label="Close">
          <X />
        </button>
      </div>
      {element.multiple && (
        <button type="button" className="global-select-all" onClick={selectAll}>
          <CheckSquare /> Select All
        </button>
      )}
      <div className="global-select-options">
        {options.map((option, index) => (
          <button
            type="button"
            key={`${option.value}:${index}`}
            disabled={option.disabled}
            className={option.selected ? "selected" : ""}
            onClick={() => choose(option)}
          >
            {element.multiple ? (
              option.selected ? (
                <CheckSquare />
              ) : (
                <Square />
              )
            ) : (
              <span />
            )}
            <b>{option.text}</b>
            {!element.multiple && option.selected && (
              <Check className="selected-check" />
            )}
          </button>
        ))}
        {!options.length && <p>No matching options found.</p>}
      </div>
      {element.multiple && (
        <footer>
          <span>{Array.from(element.selectedOptions).length} selected</span>
          <button type="button" onClick={() => setOpen(null)}>
            Done
          </button>
        </footer>
      )}
    </div>
  );
}
