/**
 * The beta invite email: when the operator creates an invite, the API emails its person a link
 * that opens sign-up with the code filled in. The code travels after `#`, so it never reaches a
 * server log. The operator still sees the code once, as a fallback when mail is off or fails.
 */

import type { MailMessage } from "@draft-loop/mail";

import type { ApiMail } from "./api-mail.js";
import type { InvitedAccount } from "./identity-accounts.js";

export type InviteMailLocale = "en" | "fr";

/** Emails one invite; resolves whether the provider accepted it, and never rejects. */
export type InviteMailer = (input: {
  readonly email: string;
  readonly code: string;
  /** The person's language when known; both languages otherwise. */
  readonly locale?: InviteMailLocale;
  /**
   * The sign-in account the API prepared for the invite (#3082): `password-email` when the
   * provider sent its own email to choose a password, `exists` when the person already has one.
   * Unset where the API prepares none and the person registers at the provider.
   */
  readonly signIn?: InvitedAccount;
}) => Promise<boolean>;

/** The link that opens sign-up with the code filled in. */
export function inviteLink(serviceUrl: string, code: string): string {
  return `${serviceUrl}/#invite=${encodeURIComponent(code)}`;
}

function english(link: string, code: string, signIn?: InvitedAccount): string[] {
  const steps =
    signIn === "password-email"
      ? [
          "Your place in the DraftLoop beta is ready. First, choose your password from the separate DraftLoop email sent to this address at the same time. Then open this link to create your account; your invite code is already filled in:",
        ]
      : signIn === "exists"
        ? [
            "Your place in the DraftLoop beta is ready. Open this link and sign in with your existing DraftLoop password; your invite code is already filled in:",
          ]
        : [
            "Your place in the DraftLoop beta is ready. Open this link to create your account; your invite code is already filled in:",
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
    ...(signIn === "password-email"
      ? [
          "",
          "If the password email is missing or its link has expired, choose Forgot password on the sign-in page.",
        ]
      : []),
    "",
    "If you did not ask to join, ignore this email.",
    "",
    "The DraftLoop team",
  ];
}

function french(link: string, code: string, signIn?: InvitedAccount): string[] {
  const steps =
    signIn === "password-email"
      ? [
          "Votre place dans la beta de DraftLoop est prête. Choisissez d'abord votre mot de passe depuis l'autre email de DraftLoop envoyé en même temps à cette adresse. Ouvrez ensuite ce lien pour créer votre compte ; votre code d'invitation est déjà rempli :",
        ]
      : signIn === "exists"
        ? [
            "Votre place dans la beta de DraftLoop est prête. Ouvrez ce lien et connectez-vous avec votre mot de passe DraftLoop actuel ; votre code d'invitation est déjà rempli :",
          ]
        : [
            "Votre place dans la beta de DraftLoop est prête. Ouvrez ce lien pour créer votre compte ; votre code d'invitation est déjà rempli :",
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
    ...(signIn === "password-email"
      ? [
          "",
          "Si l'email du mot de passe n'arrive pas ou si son lien a expiré, choisissez Mot de passe oublié sur la page de connexion.",
        ]
      : []),
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
  readonly signIn?: InvitedAccount;
}): Pick<MailMessage, "subject" | "text"> {
  const link = inviteLink(input.serviceUrl, input.code);
  const { signIn } = input;
  if (input.locale === "en") {
    return {
      subject: "Your DraftLoop beta invite",
      text: english(link, input.code, signIn).join("\n"),
    };
  }
  if (input.locale === "fr") {
    return {
      subject: "Votre invitation à la beta de DraftLoop",
      text: french(link, input.code, signIn).join("\n"),
    };
  }
  return {
    subject: "Votre invitation à DraftLoop / Your DraftLoop invite",
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
 * realm can refuse registration. A failure is logged and the email still goes without the
 * password step: the operator then sends the sign-in again from the operator routes.
 */
export function withInvitedAccount(
  mailer: InviteMailer,
  prepare: (input: {
    readonly email: string;
    readonly locale?: InviteMailLocale;
  }) => Promise<InvitedAccount>,
  onError: (error: unknown) => void,
): InviteMailer {
  return async (input) => {
    let signIn: InvitedAccount | undefined;
    try {
      signIn = await prepare({
        email: input.email,
        ...(input.locale === undefined ? {} : { locale: input.locale }),
      });
    } catch (error) {
      onError(error);
    }
    return mailer({ ...input, ...(signIn === undefined ? {} : { signIn }) });
  };
}
