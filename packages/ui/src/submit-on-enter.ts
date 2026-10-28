import type { KeyboardEvent } from "react";

/**
 * Enter in a single-line field runs the field's primary action, as it would inside a form
 * (#1889). The field's own button stays the guard: `submit` re-checks what the button's
 * disabled state checks, so Enter never does what a click could not. Enter while an input
 * method is composing a character belongs to the input method, and modified Enter is left
 * to whoever else listens.
 */
export function submitOnEnter(
  submit: () => void,
): (event: KeyboardEvent<HTMLInputElement>) => void {
  return (event) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    submit();
  };
}
