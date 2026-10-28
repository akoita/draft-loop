import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CredentialRow } from "./provider-authentication.js";
import { ApprovalOverrideEditor } from "./review-footer.js";
import { submitOnEnter } from "./submit-on-enter.js";

interface KeyEvent {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly nativeEvent: { readonly isComposing: boolean };
  readonly preventDefault: () => void;
}

function key(overrides: Partial<KeyEvent> = {}): KeyEvent {
  return {
    key: "Enter",
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
    ...overrides,
  };
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement(node)) return [];
  const children = (node as ReactElement<{ readonly children?: ReactNode }>).props.children;
  return [
    node as ReactElement<Record<string, unknown>>,
    ...Children.toArray(children).flatMap(elements),
  ];
}

function pressOn(view: ReactNode, event: KeyEvent): void {
  const input = elements(view).find((element) => element.type === "input");
  if (input === undefined) throw new Error("Expected an input.");
  (input.props.onKeyDown as (event: KeyEvent) => void)(event);
}

describe("submitOnEnter", () => {
  it("runs the action on a plain Enter and keeps the browser from acting on it", () => {
    const submit = vi.fn();
    const event = key();
    submitOnEnter(submit)(event as never);
    expect(submit).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves other keys, modified Enter and Enter during input composition alone", () => {
    const submit = vi.fn();
    const handler = submitOnEnter(submit);
    for (const event of [
      key({ key: "a" }),
      key({ shiftKey: true }),
      key({ altKey: true }),
      key({ ctrlKey: true }),
      key({ metaKey: true }),
      key({ nativeEvent: { isComposing: true } }),
    ]) {
      handler(event as never);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("Enter in single-line action fields", () => {
  const override = {
    open: true,
    onOpenChange: () => undefined,
    reason: "  Real gaps in the synthetic profile  ",
    onReasonChange: () => undefined,
    disabled: false,
    onSubmit: vi.fn(),
  };

  it("approves with override from the reason field, trimmed, as the button does", () => {
    const onSubmit = vi.fn();
    pressOn(ApprovalOverrideEditor({ override: { ...override, onSubmit } }), key());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Real gaps in the synthetic profile");
  });

  it("does nothing on Enter while the override button could not be clicked", () => {
    const onSubmit = vi.fn();
    pressOn(ApprovalOverrideEditor({ override: { ...override, reason: "  ", onSubmit } }), key());
    pressOn(ApprovalOverrideEditor({ override: { ...override, disabled: true, onSubmit } }), key());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("saves a typed provider key on Enter and ignores Enter in an empty field", () => {
    const onSave = vi.fn();
    const row = (value: string) =>
      CredentialRow({
        title: "Synthetic provider key",
        placeholder: "sk-…",
        status: { provider: "anthropic", configured: false, source: "none", protection: "none" },
        value,
        revealed: false,
        onReveal: () => undefined,
        onChange: () => undefined,
        onSave,
        onRemove: () => undefined,
      });
    pressOn(row(""), key());
    expect(onSave).not.toHaveBeenCalled();
    pressOn(row("synthetic-key-value"), key());
    expect(onSave).toHaveBeenCalledOnce();
  });
});
