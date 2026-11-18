/**
 * Transactional email from the hosted service (#2539): a provider-independent port, an adapter
 * for Brevo's transactional API (the beta's sender, chosen 2026-11-08) and its configuration. The
 * API and the worker both send through it. Mail is off unless the deployment configures a sender,
 * and a log line names the template and the outcome, never the address or the text.
 */

/** A partial or invalid mail setting; the runtime stops at start rather than send nothing. */
export class MailConfigError extends Error {
  override readonly name = "MailConfigError";
}

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Sends one message; rejects with `MailSendError` when the provider refuses it. */
export type MailSender = (message: MailMessage) => Promise<void>;

export class MailSendError extends Error {
  override readonly name = "MailSendError";
  constructor(readonly status: number | undefined) {
    super(
      status === undefined
        ? "The mail provider could not be reached."
        : `The mail provider answered ${status}.`,
    );
  }
}

export interface MailConfig {
  /** The sender address, on a domain the provider has verified. */
  readonly from: string;
  /** The Secret Manager secret version that holds the provider's API key. */
  readonly keySecret: string;
  /** The service's public address, the only link a message carries. */
  readonly serviceUrl: string;
}

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/u;
const secretVersionPattern = /^projects\/[^/]+\/secrets\/[^/]+\/versions\/[^/]+$/u;

/**
 * Reads the sender from `DRAFT_LOOP_MAIL_FROM`, `DRAFT_LOOP_MAIL_KEY_SECRET` and
 * `DRAFT_LOOP_PUBLIC_URL`. All unset turns mail off; a partial or invalid set is an error.
 */
export function readMailConfig(env: NodeJS.ProcessEnv): MailConfig | undefined {
  const from = env.DRAFT_LOOP_MAIL_FROM?.trim() ?? "";
  const keySecret = env.DRAFT_LOOP_MAIL_KEY_SECRET?.trim() ?? "";
  const serviceUrl = env.DRAFT_LOOP_PUBLIC_URL?.trim() ?? "";
  if (from === "" && keySecret === "") return undefined;
  if (!emailPattern.test(from)) {
    throw new MailConfigError("DRAFT_LOOP_MAIL_FROM must be the sender's email address.");
  }
  if (!secretVersionPattern.test(keySecret)) {
    throw new MailConfigError(
      "DRAFT_LOOP_MAIL_KEY_SECRET must name a Secret Manager secret version.",
    );
  }
  let url: URL;
  try {
    url = new URL(serviceUrl);
  } catch {
    throw new MailConfigError("DRAFT_LOOP_PUBLIC_URL must be the service's https address.");
  }
  if (url.protocol !== "https:") {
    throw new MailConfigError("DRAFT_LOOP_PUBLIC_URL must be the service's https address.");
  }
  return { from, keySecret, serviceUrl: url.origin };
}

export const brevoEndpoint = "https://api.brevo.com/v3/smtp/email";

export interface BrevoMailOptions {
  readonly from: string;
  /** Reads the API key when a message is sent, so a rotated key is picked up. */
  readonly apiKey: () => Promise<string>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Sends through Brevo's transactional API, as plain text with no tracking. */
export function createBrevoMailSender(options: BrevoMailOptions): MailSender {
  const fetchImpl = options.fetch ?? fetch;
  return async (message) => {
    const apiKey = await options.apiKey();
    let response: Response;
    try {
      response = await fetchImpl(brevoEndpoint, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: options.from, name: "DraftLoop" },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
    } catch {
      throw new MailSendError(undefined);
    }
    if (!response.ok) throw new MailSendError(response.status);
  };
}

export interface MailLog {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

/** Wraps a sender with one content-free log line per message: the template and the outcome. */
export function loggedMailSender<Template extends string>(send: MailSender, log: MailLog) {
  return async (template: Template, message: MailMessage): Promise<boolean> => {
    try {
      await send(message);
      log.info({ event: "mail_sent", template }, "mail sent");
      return true;
    } catch (error) {
      const status = error instanceof MailSendError ? error.status : undefined;
      log.warn({ event: "mail_failed", template, status }, "mail not sent");
      return false;
    }
  };
}
