import {
  type Dispatch,
  type ReactNode,
  type Ref,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { useShowEverything } from "./display-preference.js";

/**
 * The open state of a folded section that follows the Display choice: open with Show everything,
 * folded otherwise. The person can still open or fold it, and a new Display choice replaces that,
 * so a switch shows at once on every screen already open.
 */
export function useDisplayFold(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const everything = useShowEverything();
  const [open, setOpen] = useState(everything);
  const shownMode = useRef(everything);
  useEffect(() => {
    if (shownMode.current === everything) return;
    shownMode.current = everything;
    setOpen(everything);
  }, [everything]);
  return [open, setOpen];
}

/**
 * A `<details>` section that starts open with Show everything. Use it for every fold that hides
 * detail a person may want, so the three Display choices look different on every screen.
 */
export function DisplayFold({
  className,
  ref,
  children,
}: {
  readonly className: string;
  readonly ref?: Ref<HTMLDetailsElement>;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useDisplayFold();
  return (
    <details
      className={className}
      ref={ref}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {children}
    </details>
  );
}
