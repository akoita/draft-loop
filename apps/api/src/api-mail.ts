/**
 * The API's transactional email: the shared Brevo sender from `@draft-loop/mail` with its key
 * read from Secret Manager, and one content-free log line per message. The templates live beside
 * the features that send them (invite-mail.ts, waitlist-confirm-mail.ts, feedback-reply-mail.ts).
 */

import {
  createBrevoMailSender,
  loggedMailSender,
  type MailConfig,
  type MailMessage,
  type MailSender,
  readMailConfig,
} from "@draft-loop/mail";
import { createSecretManagerCredentialResolver } from "@draft-loop/model-gateway";

export type ApiMailTemplate = "beta_invite" | "waitlist_confirm" | "feedback_reply";

export interface ApiMail {
  /** The service's public address, the only site a message links to. */
  readonly serviceUrl: string;
  /** Sends one message; resolves whether the provider accepted it, and never rejects. */
  readonly send: (template: ApiMailTemplate, message: MailMessage) => Promise<boolean>;
}

export interface ApiMailLogLine {
  readonly severity: "INFO" | "WARNING";
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

export interface ApiMailOptions {
  readonly log?: (line: ApiMailLogLine) => void;
  /** Replaces the Brevo sender, in tests. */
  readonly send?: MailSender;
}

/**
 * The API's mail, or undefined when the deployment sets no sender (`DRAFT_LOOP_MAIL_FROM`,
 * `DRAFT_LOOP_MAIL_KEY_SECRET`, `DRAFT_LOOP_PUBLIC_URL`). A partial setting throws at start.
 */
export function readApiMail(
  env: NodeJS.ProcessEnv,
  options: ApiMailOptions = {},
): ApiMail | undefined {
  const config = readMailConfig(env);
  return config === undefined ? undefined : createApiMail(config, options);
}

export function createApiMail(config: MailConfig, options: ApiMailOptions = {}): ApiMail {
  const log =
    options.log ??
    ((line: ApiMailLogLine) =>
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
  // A refused send or an unreadable key resolves false; the log names the template only.
  const logged = loggedMailSender<ApiMailTemplate>(send, {
    info: (fields, message) => log({ severity: "INFO", message, fields }),
    warn: (fields, message) => log({ severity: "WARNING", message, fields }),
  });
  return { serviceUrl: config.serviceUrl, send: logged };
}
