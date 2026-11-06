import "./picker.css";

import type { PickerApi, PickerView } from "../picker-contract.js";
import { isLoopbackHost } from "../server-address.js";
import { type ShellText, shellReason, shellText } from "../shell-text.js";

declare global {
  interface Window {
    readonly draftLoopPicker: PickerApi;
  }
}

const picker = window.draftLoopPicker;
let text: ShellText = shellText.en;
let language: keyof typeof shellText = "en";

/** Writes the page's fixed words in the shell's language. */
function translatePage(): void {
  document.documentElement.lang = language;
  document.title = text.pickerTitle;
  for (const node of document.querySelectorAll<HTMLElement>("[data-text]")) {
    const value = text[node.dataset.text as keyof ShellText];
    if (typeof value === "string") node.textContent = value;
  }
  element<HTMLInputElement>("name").placeholder = text.optional;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The picker page has no #${id}.`);
  return found as T;
}

function isThisComputer(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.textContent = label;
  if (secondary) result.className = "secondary";
  result.addEventListener("click", onClick);
  return result;
}

async function open(address: string, name?: string): Promise<string | undefined> {
  document.body.setAttribute("aria-busy", "true");
  try {
    const result = await picker.open(address, name);
    if (result.ok) return undefined;
    render(await picker.view());
    return shellReason(result.reason, language);
  } finally {
    document.body.removeAttribute("aria-busy");
  }
}

function renderUnreachable(view: PickerView): void {
  const notice = element<HTMLElement>("unreachable");
  notice.replaceChildren();
  notice.hidden = view.unreachable === undefined;
  if (view.unreachable === undefined) return;
  const { origin, reason } = view.unreachable;
  const title = document.createElement("strong");
  title.textContent = text.cantReach(origin);
  const detail = document.createElement("p");
  const said = shellReason(reason, language);
  detail.textContent = isThisComputer(origin)
    ? text.startThisComputer(said)
    : text.checkAddress(said);
  notice.append(
    title,
    detail,
    button(text.tryAgain, () => void open(origin)),
  );
}

function render(view: PickerView): void {
  language = view.language ?? "en";
  text = shellText[language];
  translatePage();
  renderUnreachable(view);
  const list = element<HTMLUListElement>("servers");
  list.replaceChildren(
    ...view.servers.map((server) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.className = "server";
      const name = document.createElement("strong");
      name.textContent = server.name;
      const origin = document.createElement("span");
      origin.textContent = server.origin;
      label.append(name, origin);
      item.append(
        label,
        button(text.open, () => void open(server.origin)),
        button(
          text.remove,
          () => {
            if (window.confirm(text.confirmRemove(server.name))) {
              void picker.remove(server.origin).then(render);
            }
          },
          true,
        ),
      );
      return item;
    }),
  );
  element<HTMLElement>("no-servers").hidden = view.servers.length > 0;
}

element<HTMLFormElement>("add").addEventListener("submit", (event) => {
  event.preventDefault();
  const error = element<HTMLElement>("add-error");
  error.textContent = "";
  void open(
    element<HTMLInputElement>("address").value,
    element<HTMLInputElement>("name").value,
  ).then((reason) => {
    error.textContent = reason ?? "";
  });
});

void picker.view().then(render);
