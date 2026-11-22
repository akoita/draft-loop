/**
 * The operator's reply to a feedback note (#2878): the operator writes it on the operator screen,
 * and the API emails it to the member who sent the note. The member's address never leaves the
 * server; the message names the note by its reference, never by its text.
 */

import type { MailMessage } from "@draft-loop/mail";

import type { ApiMail } from "./api-mail.js";

export type FeedbackReplyLocale = "en" | "fr";

/** Emails one reply; resolves whether the provider accepted it, and never rejects. */
export type FeedbackReplyMailer = (input: {
  readonly email: string;
  /** The note's reference, such as `FB-1A2B3C4D`, as the member saw it. */
  readonly reference: string;
  readonly text: string;
  readonly locale?: FeedbackReplyLocale;
}) => Promise<boolean>;

/** The reference the member was shown when they sent the note: `FB-` and eight id characters. */
export function feedbackReference(noteId: string): string {
  return `FB-${noteId
    .replace(/[^A-Za-z0-9]/gu, "")
    .slice(0, 8)
    .toUpperCase()}`;
}

/** The member's language from the note's browser language, when it is one we write. */
export function feedbackReplyLocale(language: string | undefined): FeedbackReplyLocale | undefined {
  const primary = language?.toLowerCase().split("-")[0];
  return primary === "fr" || primary === "en" ? primary : undefined;
}

function english(reference: string, text: string, serviceUrl: string): string[] {
  return [
    "Hello,",
    "",
    `Thank you for your note ${reference} about Redakloop. Here is our answer:`,
    "",
    text,
    "",
    `To answer, use Send feedback in Redakloop (${serviceUrl}) and quote ${reference}. Replies to this email are not read.`,
    "",
    "The Redakloop team",
  ];
}

function french(reference: string, text: string, serviceUrl: string): string[] {
  return [
    "Bonjour,",
    "",
    `Merci pour votre avis ${reference} sur Redakloop. Voici notre réponse :`,
    "",
    text,
    "",
    `Pour répondre, utilisez Envoyer un avis dans Redakloop (${serviceUrl}) en citant ${reference}. Les réponses à cet email ne sont pas lues.`,
    "",
    "L'équipe Redakloop",
  ];
}

/** The reply in the member's language, or French then English when it is unknown. */
export function feedbackReplyMessage(input: {
  readonly reference: string;
  readonly text: string;
  readonly serviceUrl: string;
  readonly locale?: FeedbackReplyLocale;
}): Pick<MailMessage, "subject" | "text"> {
  const { reference, text, serviceUrl } = input;
  if (input.locale === "en") {
    return {
      subject: `About your Redakloop note ${reference}`,
      text: english(reference, text, serviceUrl).join("\n"),
    };
  }
  if (input.locale === "fr") {
    return {
      subject: `À propos de votre avis Redakloop ${reference}`,
      text: french(reference, text, serviceUrl).join("\n"),
    };
  }
  return {
    subject: `Votre avis / Your note ${reference}: Redakloop`,
    text: [
      ...french(reference, text, serviceUrl),
      "",
      "----",
      "",
      ...english(reference, text, serviceUrl),
    ].join("\n"),
  };
}

export function createFeedbackReplyMailer(mail: ApiMail): FeedbackReplyMailer {
  return ({ email, reference, text, locale }) =>
    mail.send("feedback_reply", {
      to: email,
      ...feedbackReplyMessage({
        reference,
        text,
        serviceUrl: mail.serviceUrl,
        ...(locale === undefined ? {} : { locale }),
      }),
    });
}
