/**
 * The waitlist's confirmation email (double opt-in): a visitor who joins gets a link that proves
 * the address is theirs, and only a confirmed entry waits for a place. The token rides after `#`,
 * so it never reaches a server log; the screen posts it to `POST /v1/waitlist/confirm`.
 */

import type { MailMessage } from "@draft-loop/mail";

import type { ApiMail } from "./api-mail.js";

export type WaitlistMailLocale = "en" | "fr";

/** How long a confirmation link works; the worker deletes unconfirmed entries after it. */
export const waitlistConfirmHours = 48;

/** Emails one confirmation link; resolves whether the provider accepted it, and never rejects. */
export type WaitlistConfirmMailer = (input: {
  readonly email: string;
  readonly token: string;
  readonly locale?: WaitlistMailLocale;
}) => Promise<boolean>;

/** The link that confirms the address. */
export function waitlistConfirmLink(serviceUrl: string, token: string): string {
  return `${serviceUrl}/#waitlist-confirm=${encodeURIComponent(token)}`;
}

function english(link: string): string[] {
  return [
    "Hello,",
    "",
    "Someone, probably you, asked to join the Redakloop beta waitlist with this address. Open this link to confirm it:",
    "",
    link,
    "",
    `The link works for ${waitlistConfirmHours} hours. Your place in line counts once you confirm. We will email you again when your place is ready.`,
    "",
    "If it was not you, ignore this email: the request is deleted after that.",
    "",
    "The Redakloop team",
  ];
}

function french(link: string): string[] {
  return [
    "Bonjour,",
    "",
    "Quelqu'un, sans doute vous, a demandé à rejoindre la liste d'attente de la beta de Redakloop avec cette adresse. Ouvrez ce lien pour la confirmer :",
    "",
    link,
    "",
    `Le lien fonctionne pendant ${waitlistConfirmHours} heures. Votre place compte dès que vous confirmez. Nous vous écrirons à nouveau quand votre place sera prête.`,
    "",
    "Si ce n'était pas vous, ignorez cet email : la demande sera ensuite supprimée.",
    "",
    "L'équipe Redakloop",
  ];
}

/** The confirmation message in the visitor's language, or French then English when unknown. */
export function waitlistConfirmMessage(input: {
  readonly token: string;
  readonly serviceUrl: string;
  readonly locale?: WaitlistMailLocale;
}): Pick<MailMessage, "subject" | "text"> {
  const link = waitlistConfirmLink(input.serviceUrl, input.token);
  if (input.locale === "en") {
    return {
      subject: "Confirm your email for the Redakloop waitlist",
      text: english(link).join("\n"),
    };
  }
  if (input.locale === "fr") {
    return {
      subject: "Confirmez votre email pour la liste d'attente Redakloop",
      text: french(link).join("\n"),
    };
  }
  return {
    subject: "Confirmez votre email / Confirm your email: Redakloop",
    text: [...french(link), "", "----", "", ...english(link)].join("\n"),
  };
}

export function createWaitlistConfirmMailer(mail: ApiMail): WaitlistConfirmMailer {
  return ({ email, token, locale }) =>
    mail.send("waitlist_confirm", {
      to: email,
      ...waitlistConfirmMessage({
        token,
        serviceUrl: mail.serviceUrl,
        ...(locale === undefined ? {} : { locale }),
      }),
    });
}
