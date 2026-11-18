/**
 * The beta invite email: when the operator creates an invite, the API emails its person a link
 * that opens sign-up with the code filled in. The code travels after `#`, so it never reaches a
 * server log. The operator still sees the code once, as a fallback when mail is off or fails.
 */

import {
  createBrevoMailSender,
  loggedMailSender,
  type MailConfig,
  type MailMessage,
  readMailConfig,
} from "@draft-loop/mail";
import { createSecretManagerCredentialResolver } from "@draft-loop/model-gateway";

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

interface MailLogLine {
  readonly severity: "INFO" | "WARNING";
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

/**
 * The API's invite mailer over the shared Brevo sender, or undefined when the deployment sets no
 * sender (`DRAFT_LOOP_MAIL_FROM`, `DRAFT_LOOP_MAIL_KEY_SECRET`, `DRAFT_LOOP_PUBLIC_URL`). A
 * partial setting throws at start. Logs name the template and the outcome only.
 */
export function readInviteMailer(
  env: NodeJS.ProcessEnv,
  options: {
    readonly log?: (line: MailLogLine) => void;
    readonly send?: Parameters<typeof loggedMailSender>[0];
  } = {},
): InviteMailer | undefined {
  const config = readMailConfig(env);
  if (config === undefined) return undefined;
  return createInviteMailer(config, options);
}

export function createInviteMailer(
  config: MailConfig,
  options: {
    readonly log?: (line: MailLogLine) => void;
    readonly send?: Parameters<typeof loggedMailSender>[0];
  } = {},
): InviteMailer {
  const log =
    options.log ??
    ((line: MailLogLine) =>
      console.info(
        JSON.stringify({ severity: line.severity, message: line.message, ...line.fields }),
      ));
  let send = options.send;
  if (send === undefined) {
    const resolveKey = createSecretManagerCredentialResolver({
      secrets: { brevo: config.keySecret },
    });
    send = createBrevoMailSender({
      from: config.from,
      apiKey: async () => {
        const key = await resolveKey("brevo");
        if (key === undefined) throw new Error("The mail key is missing.");
        return key;
      },
    });
  }
  const logged = loggedMailSender<"beta_invite">(send, {
    info: (fields, message) => log({ severity: "INFO", message, fields }),
    warn: (fields, message) => log({ severity: "WARNING", message, fields }),
  });
  // A refused send or an unreadable key resolves false: the operator still has the code.
  return ({ email, code, locale }) =>
    logged("beta_invite", {
      to: email,
      ...inviteMessage({
        code,
        serviceUrl: config.serviceUrl,
        ...(locale === undefined ? {} : { locale }),
      }),
    });
}
