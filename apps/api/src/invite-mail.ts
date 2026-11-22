/**
 * The beta invite email: when the operator creates an invite, the API emails its person a link
 * that opens sign-up with the code filled in. The code travels after `#`, so it never reaches a
 * server log. The operator still sees the code once, as a fallback when mail is off or fails.
 *
 * Where the API prepares the person's sign-in (#3082), the identity provider's choose-a-password
 * email is the invite and this one is not sent, so the person gets one email with one link.
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
  /**
   * `exists` when the person already has a sign-in with a password (#3082). Unset where the API
   * prepares no sign-in, or preparing it failed.
   */
  readonly signIn?: "exists";
}) => Promise<boolean>;

/** The link that opens sign-up with the code filled in. */
export function inviteLink(serviceUrl: string, code: string): string {
  return `${serviceUrl}/#invite=${encodeURIComponent(code)}`;
}

function english(link: string, code: string, signIn?: "exists"): string[] {
  const steps =
    signIn === "exists"
      ? [
          "Your place in the Redakloop beta is ready. Open this link and sign in with your existing Redakloop password; your invite code is already filled in:",
        ]
      : [
          "Your place in the Redakloop beta is ready. Open this link to create your account; your invite code is already filled in:",
        ];
  return [
    "Hello,",
    "",
    ...steps,
    "",
    link,
    "",
    "Sign in with this email address: the invite works only for it.",
    "",
    `If the link does not open, sign in at the same address and enter this code: ${code}`,
    "",
    "If you did not ask to join, ignore this email.",
    "",
    "The Redakloop team",
  ];
}

function french(link: string, code: string, signIn?: "exists"): string[] {
  const steps =
    signIn === "exists"
      ? [
          "Votre place dans la beta de Redakloop est prête. Ouvrez ce lien et connectez-vous avec votre mot de passe Redakloop actuel ; votre code d'invitation est déjà rempli :",
        ]
      : [
          "Votre place dans la beta de Redakloop est prête. Ouvrez ce lien pour créer votre compte ; votre code d'invitation est déjà rempli :",
        ];
  return [
    "Bonjour,",
    "",
    ...steps,
    "",
    link,
    "",
    "Connectez-vous avec cette adresse email : l'invitation ne fonctionne que pour elle.",
    "",
    `Si le lien ne s'ouvre pas, connectez-vous à la même adresse et saisissez ce code : ${code}`,
    "",
    "Si vous n'avez rien demandé, ignorez cet email.",
    "",
    "L'équipe Redakloop",
  ];
}

/** The invite message in the person's language, or French then English when it is unknown. */
export function inviteMessage(input: {
  readonly code: string;
  readonly serviceUrl: string;
  readonly locale?: InviteMailLocale;
  readonly signIn?: "exists";
}): Pick<MailMessage, "subject" | "text"> {
  const link = inviteLink(input.serviceUrl, input.code);
  const { signIn } = input;
  if (input.locale === "en") {
    return {
      subject: "Your Redakloop beta invite",
      text: english(link, input.code, signIn).join("\n"),
    };
  }
  if (input.locale === "fr") {
    return {
      subject: "Votre invitation à la beta de Redakloop",
      text: french(link, input.code, signIn).join("\n"),
    };
  }
  return {
    subject: "Votre invitation à Redakloop / Your Redakloop invite",
    text: [
      ...french(link, input.code, signIn),
      "",
      "----",
      "",
      ...english(link, input.code, signIn),
    ].join("\n"),
  };
}

/** The invite mailer over the API's mail; a refused send resolves false, so the operator still has the code. */
export function createInviteMailer(mail: ApiMail): InviteMailer {
  return ({ email, code, locale, signIn }) =>
    mail.send("beta_invite", {
      to: email,
      ...inviteMessage({
        code,
        serviceUrl: mail.serviceUrl,
        ...(locale === undefined ? {} : { locale }),
        ...(signIn === undefined ? {} : { signIn }),
      }),
    });
}

/**
 * Prepares the invited person's sign-in account before their invite email goes (#3082), so the
 * realm can refuse registration. When the provider sent its choose-a-password email, that email is
 * the invite and this one is skipped: the person gets one email. Someone who already has a
 * password gets this one. A failure is logged and this email still goes, with its code: the
 * operator then prepares the sign-in again from the operator routes.
 */
export function withInvitedAccount(
  mailer: InviteMailer,
  prepare: (input: {
    readonly email: string;
    readonly locale?: InviteMailLocale;
  }) => Promise<"password-email" | "exists">,
  onError: (error: unknown) => void,
): InviteMailer {
  return async (input) => {
    let prepared: "password-email" | "exists" | undefined;
    try {
      prepared = await prepare({
        email: input.email,
        ...(input.locale === undefined ? {} : { locale: input.locale }),
      });
    } catch (error) {
      onError(error);
    }
    if (prepared === "password-email") return true;
    return mailer({ ...input, ...(prepared === "exists" ? { signIn: "exists" as const } : {}) });
  };
}
