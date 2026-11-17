import type { SecretVersionReader } from "@draft-loop/model-gateway";
import { createSecretManagerCredentialResolver } from "@draft-loop/model-gateway";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

/**
 * The planned-maintenance notice (#2965). The operator sets it in a Secret Manager version, so it
 * changes without a deploy; the API reads it, serves it to every screen and, while a read-only
 * notice has started, refuses changes. Read-only lasts until the notice is cleared, not until its
 * announced end, so an overrun never reopens writes.
 */
export const serviceNoticePath = "/v1/service-notice";

/** What the operator stores: an empty value or `{}` means no notice. */
const storedNoticeSchema = z.object({
  kind: z.literal("maintenance"),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  readOnly: z.boolean().optional(),
});

export type StoredServiceNotice = z.infer<typeof storedNoticeSchema>;

const noticeSchema = z
  .object({
    kind: z.literal("maintenance"),
    startsAt: z.string().describe("When the maintenance starts, ISO 8601."),
    endsAt: z.string().describe("When the maintenance is announced to end, ISO 8601."),
    readOnly: z.boolean().describe("True when changes are paused once it has started."),
    state: z
      .enum(["upcoming", "ongoing", "overrunning"])
      .describe(
        "upcoming before it starts; ongoing until its announced end; overrunning when changes are still paused after it.",
      ),
  })
  .meta({ id: "ServiceNotice" });

const responseSchema = z
  .object({ notice: noticeSchema.nullable() })
  .meta({ id: "ServiceNoticeResponse" });

export type ServiceNotice = z.infer<typeof noticeSchema>;

/** Gives the stored notice, or `undefined` when there is none or it cannot be read. */
export type ServiceNoticeSource = () => Promise<StoredServiceNotice | undefined>;

/** Parses the stored text; anything that is not a valid notice counts as no notice. */
export function parseStoredNotice(text: string | undefined): StoredServiceNotice | undefined {
  const trimmed = text?.trim() ?? "";
  if (trimmed === "" || trimmed === "{}") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const parsed = storedNoticeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The notice as the screens see it at `now`; a past notice that pauses nothing is gone. */
export function currentNotice(
  stored: StoredServiceNotice | undefined,
  now: Date,
): ServiceNotice | undefined {
  if (stored === undefined) return undefined;
  const start = Date.parse(stored.startsAt);
  const end = Date.parse(stored.endsAt);
  const at = now.getTime();
  const readOnly = stored.readOnly === true;
  let state: ServiceNotice["state"];
  if (at < start) state = "upcoming";
  else if (at < end) state = "ongoing";
  else if (readOnly) state = "overrunning";
  else return undefined;
  return { kind: "maintenance", startsAt: stored.startsAt, endsAt: stored.endsAt, readOnly, state };
}

export interface SecretNoticeOptions {
  /** `projects/<project>/secrets/<name>/versions/latest`, from the deployment. */
  readonly secret: string;
  readonly client?: SecretVersionReader;
  /** How long a read stays in memory; a change shows within it. One minute. */
  readonly ttlMs?: number;
  readonly onReadError?: (error: unknown) => void;
}

/** Reads the notice from Secret Manager; a failed read means no notice, never a refused request. */
export function secretServiceNotice(options: SecretNoticeOptions): ServiceNoticeSource {
  const resolve = createSecretManagerCredentialResolver({
    secrets: { notice: options.secret },
    ttlMs: options.ttlMs ?? 60_000,
    ...(options.client === undefined ? {} : { client: options.client }),
  });
  return async () => {
    try {
      return parseStoredNotice(await resolve("notice"));
    } catch (error) {
      options.onReadError?.(error);
      return undefined;
    }
  };
}

/** Reads `DRAFT_LOOP_SERVICE_NOTICE_SECRET`; unset means this deployment has no notice. */
export function readServiceNoticeSecret(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.DRAFT_LOOP_SERVICE_NOTICE_SECRET?.trim() ?? "";
  return value === "" ? undefined : value;
}

const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export interface ServiceNoticeOptions {
  readonly source: ServiceNoticeSource;
  readonly now?: () => Date;
  /** Writes that stay open during maintenance, by route: the screen's crash reports. */
  readonly openWrites?: ReadonlySet<string>;
}

/** Seconds until the announced end, at least a minute, for `Retry-After`. */
function retryAfterSeconds(notice: ServiceNotice, now: Date): number {
  return Math.max(60, Math.ceil((Date.parse(notice.endsAt) - now.getTime()) / 1000));
}

/** Serves the notice publicly and refuses `/v1` writes while a read-only notice has started. */
export function registerServiceNotice(app: FastifyInstance, options: ServiceNoticeOptions): void {
  const now = options.now ?? (() => new Date());
  app.withTypeProvider<ZodTypeProvider>().get(
    serviceNoticePath,
    {
      schema: {
        summary: "The current planned-maintenance notice, if any",
        security: [],
        response: { 200: responseSchema },
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return { notice: currentNotice(await options.source(), now()) ?? null };
    },
  );
  app.addHook("onRequest", async (request, reply) => {
    if (readMethods.has(request.method)) return;
    if (request.url !== "/v1" && !request.url.startsWith("/v1/")) return;
    const route = request.routeOptions.url;
    if (route !== undefined && options.openWrites?.has(route) === true) return;
    const at = now();
    const notice = currentNotice(await options.source(), at);
    if (notice === undefined || !notice.readOnly || notice.state === "upcoming") return;
    await reply
      .code(503)
      .header("retry-after", String(retryAfterSeconds(notice, at)))
      .send({
        error: {
          code: "service_maintenance",
          message:
            notice.state === "ongoing"
              ? `Changes are paused for planned maintenance until ${notice.endsAt}. The service comes back on its own.`
              : "Changes are still paused: the planned maintenance is taking longer than announced. The service comes back on its own.",
          params: { endsAt: notice.endsAt },
        },
      });
  });
}
