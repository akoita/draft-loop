import { Activity, type ReactNode, useLayoutEffect, useRef } from "react";

/**
 * A workspace page that stays mounted while another page is shown, so returning to it finds its
 * state as it was left: form drafts, open panels, the step reached. Hidden pages keep their state
 * but not their effects, which run again when the page is shown.
 */
export function KeptPage({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Activity mode={active ? "visible" : "hidden"}>
      <ScrollKeeper>{children}</ScrollKeeper>
    </Activity>
  );
}

/**
 * Hiding a page drops the scroll offsets of its scrolling regions, so they are recorded as the
 * person scrolls and put back when the page is shown again.
 */
function ScrollKeeper({ children }: { readonly children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const offsets = useRef(new Map<Element, number>());

  // Runs each time the page is shown, before focus moves to its location line. Scroll events do
  // not bubble, so one capturing listener hears every region of the page.
  useLayoutEffect(() => {
    const element = container.current;
    if (element === null) return;
    for (const [region, top] of offsets.current) {
      if (region.isConnected) region.scrollTop = top;
      else offsets.current.delete(region);
    }
    const record = (event: Event) => {
      if (event.target instanceof Element) {
        offsets.current.set(event.target, event.target.scrollTop);
      }
    };
    element.addEventListener("scroll", record, { capture: true, passive: true });
    return () => element.removeEventListener("scroll", record, { capture: true });
  }, []);

  return (
    <div ref={container} className="kept-page">
      {children}
    </div>
  );
}
