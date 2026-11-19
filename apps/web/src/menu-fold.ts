import { type RefObject, useEffect, useRef } from "react";

/**
 * A `<details>` menu that folds on a click outside it or on Escape, as menus elsewhere do. Returns
 * the ref to put on the element and a `fold` that closes it, for an item that opens something else.
 */
export function useFoldingMenu(): {
  readonly menu: RefObject<HTMLDetailsElement | null>;
  readonly fold: () => void;
} {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onEvent = (event: Event) => {
      const element = menu.current;
      if (element === null || !element.open) return;
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !element.contains(event.target as Node)
      )
        element.open = false;
    };
    document.addEventListener("pointerdown", onEvent);
    document.addEventListener("keydown", onEvent);
    return () => {
      document.removeEventListener("pointerdown", onEvent);
      document.removeEventListener("keydown", onEvent);
    };
  }, []);
  return {
    menu,
    fold: () => {
      if (menu.current !== null) menu.current.open = false;
    },
  };
}
