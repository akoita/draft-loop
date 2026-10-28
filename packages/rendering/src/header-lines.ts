import type { DraftArtifact } from "@draft-loop/schemas";

/** One drawn line of a CV header: the name, or a line of contact details under it. */
export interface HeaderLine {
  readonly kind: "title" | "contact";
  readonly text: string;
}

const maximumNameWords = 6;
const contactDetail = /@|https?:\/\/|www\.|linkedin|github|\+?\d[\d\s().-]{5,}\d/iu;

/**
 * Split a headline written as "Name | email | phone | city" into the name and its contact line,
 * so the name alone takes the name size (#1931). The split happens only when the part before the
 * first `|` reads as a name (no digits or `@`, at most six words) and the rest holds a contact
 * detail such as an email, a phone number or a profile address; "Name | Senior Engineer" stays
 * one headline. The separator itself is not drawn.
 */
export function splitHeadline(text: string): readonly HeaderLine[] {
  const separator = text.indexOf("|");
  if (separator < 0) return [{ kind: "title", text }];
  const name = text.slice(0, separator).trim();
  const contact = text.slice(separator + 1).trim();
  const nameWords = name.split(/\s+/u).filter((word) => word !== "").length;
  if (
    name === "" ||
    contact === "" ||
    nameWords > maximumNameWords ||
    /[\d@]/u.test(name) ||
    !contactDetail.test(contact)
  ) {
    return [{ kind: "title", text }];
  }
  return [
    { kind: "title", text: name },
    { kind: "contact", text: contact },
  ];
}

/**
 * The drawn lines of a header section: its first block is the headline, split from its contact
 * details when it carries them, and every later block is a contact line.
 */
export function headerLines(section: DraftArtifact["sections"][number]): readonly HeaderLine[] {
  return section.blocks.flatMap((block, index) =>
    index === 0 ? splitHeadline(block.text) : [{ kind: "contact" as const, text: block.text }],
  );
}
