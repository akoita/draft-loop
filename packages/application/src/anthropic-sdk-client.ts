import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import type { AnthropicClient } from "@draft-loop/providers";

/**
 * Build the default Anthropic API client using the SDK stream helper while
 * preserving the provider package's promise-based messages.create contract.
 */
export function createAnthropicSdkClient(
  apiKey: string,
  sdkOptions: Pick<ClientOptions, "fetch"> = {},
): AnthropicClient {
  const client = new Anthropic({ apiKey, maxRetries: 0, ...sdkOptions });

  return {
    messages: {
      create(parameters, options) {
        const stream = client.messages.stream(parameters, options);
        const finalMessage = stream.finalMessage();

        return Object.assign(finalMessage, {
          withResponse: async () => {
            const data = await finalMessage;
            const requestId = stream.request_id;
            return {
              data,
              ...(requestId === undefined ? {} : { request_id: requestId }),
            };
          },
        });
      },
    },
  };
}
