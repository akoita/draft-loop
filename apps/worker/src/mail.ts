/**
 * The worker's transactional email (#2539): the shared sender from `@draft-loop/mail`, read with
 * the worker's config error, and the plain-text templates the worker sends.
 */

import {
  type MailConfig,
  MailConfigError,
  type MailLog,
  type MailMessage,
  type MailSender,
  readMailConfig as readSharedMailConfig,
  loggedMailSender as sharedLoggedMailSender,
} from "@draft-loop/mail";

import { WorkerConfigError } from "./config-error.js";

export {
  brevoEndpoint,
  createBrevoMailSender,
  type MailConfig,
  type MailLog,
  type MailMessage,
  MailSendError,
  type MailSender,
} from "@draft-loop/mail";

export type MailTemplateId = "beta_inactivity_warning";

/** The worker's logged sender, typed to the worker's templates. */
export function loggedMailSender(send: MailSender, log: MailLog) {
  return sharedLoggedMailSender<MailTemplateId>(send, log);
}

/**
 * Reads the sender from `DRAFT_LOOP_MAIL_FROM`, `DRAFT_LOOP_MAIL_KEY_SECRET` and
 * `DRAFT_LOOP_PUBLIC_URL`. All unset turns mail off; a partial or invalid set is an error.
 */
export function readMailConfig(env: NodeJS.ProcessEnv): MailConfig | undefined {
  try {
    return readSharedMailConfig(env);
  } catch (error) {
    if (error instanceof MailConfigError) throw new WorkerConfigError(error.message);
    throw error;
  }
}

export type MailLocale = "en" | "fr";

export interface InactivityWarningInput {
  readonly locale: MailLocale;
  /** The day the organisation will be erased if nobody signs in. */
  readonly eraseOn: Date;
  readonly serviceUrl: string;
}

function day(date: Date, locale: MailLocale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The warning sent 14 days before an inactive beta account is erased (#2463). */
export function inactivityWarning(
  input: InactivityWarningInput,
): Pick<MailMessage, "subject" | "text"> {
  const when = day(input.eraseOn, input.locale);
  if (input.locale === "fr") {
    return {
      subject: "Votre compte Redakloop beta sera supprimé faute d'activité",
      text: [
        "Bonjour,",
        "",
        `Personne ne s'est connecté à votre compte Redakloop beta depuis longtemps. Il sera supprimé le ${when}, avec tous les documents et l'historique qu'il contient.`,
        "",
        `Pour le garder, connectez-vous avant cette date : ${input.serviceUrl}`,
        "",
        "Si vous ne souhaitez plus l'utiliser, vous n'avez rien à faire.",
        "",
        "L'équipe Redakloop",
      ].join("\n"),
    };
  }
  return {
    subject: "Your Redakloop beta account will be deleted for inactivity",
    text: [
      "Hello,",
      "",
      `Nobody has signed in to your Redakloop beta account for a long time. It will be deleted on ${when}, with every document and all the history it holds.`,
      "",
      `To keep it, sign in before then: ${input.serviceUrl}`,
      "",
      "If you no longer want it, there is nothing to do.",
      "",
      "The Redakloop team",
    ].join("\n"),
  };
}
