/**
 * The beta invite email: when the operator creates an invite, the API emails its person a link
 * that opens sign-up with the code filled in. The code travels after `#`, so it never reaches a
 * server log. The operator still sees the code once, as a fallback when mail is off or fails.
 */

import type { MailMessage } from "@draft-loop/mail";

import type { ApiMail } from "./api-mail.js";

export type InviteMailLocale = "en" | "fr";

/** Emails one invite; resolves whether the provider accepted it, and never rejects. */
export type InviteMailer = (input: {
  readonly email: string;
  readonly code: string;
  /** The person's language when known; both languages otherwise. */
  readonly locale?: InviteMailLocale;
}) => Promise<boolean>;

/** The link that opens sign-up with the code filled in. */
export function inviteLink(serviceUrl: string, code: string): string {
  return `${serviceUrl}/#invite=${encodeURIComponent(code)}`;
}

function english(link: string, code: string): string[] {
  return [
    "Hello,",
    "",
    "Your place in the DraftLoop beta is ready. Open this link to create your account; your invite code is already filled in:",
    "",
    link,
    "",
    "Sign up with this email address: the invite works only for it.",
    "",
    `If the link does not open, sign in at the same address and enter this code: ${code}`,
    "",
    "If you did not ask to join, ignore this email.",
    "",
    "The DraftLoop team",
  ];
}

function french(link: string, code: string): string[] {
  return [
    "Bonjour,",
    "",
    "Votre place dans la beta de DraftLoop est prête. Ouvrez ce lien pour créer votre compte ; votre code d'invitation est déjà rempli :",
    "",
    link,
    "",
    "Inscrivez-vous avec cette adresse email : l'invitation ne fonctionne que pour elle.",
    "",
    `Si le lien ne s'ouvre pas, connectez-vous à la même adresse et saisissez ce code : ${code}`,
    "",
    "Si vous n'avez rien demandé, ignorez cet email.",
    "",
    "L'équipe DraftLoop",
  ];
}

/** The invite message in the person's language, or French then English when it is unknown. */
export function inviteMessage(input: {
  readonly code: string;
  readonly serviceUrl: string;
  readonly locale?: InviteMailLocale;
}): Pick<MailMessage, "subject" | "text"> {
  const link = inviteLink(input.serviceUrl, input.code);
  if (input.locale === "en") {
    return {
      subject: "Your DraftLoop beta invite",
      text: english(link, input.code).join("\n"),
    };
  }
  if (input.locale === "fr") {
    return {
      subject: "Votre invitation à la beta de DraftLoop",
      text: french(link, input.code).join("\n"),
    };
  }
  return {
    subject: "Votre invitation à DraftLoop / Your DraftLoop invite",
    text: [...french(link, input.code), "", "----", "", ...english(link, input.code)].join("\n"),
  };
}

/** The invite mailer over the API's mail; a refused send resolves false, so the operator still has the code. */
export function createInviteMailer(mail: ApiMail): InviteMailer {
  return ({ email, code, locale }) =>
    mail.send("beta_invite", {
      to: email,
      ...inviteMessage({
        code,
        serviceUrl: mail.serviceUrl,
        ...(locale === undefined ? {} : { locale }),
      }),
    });
}
