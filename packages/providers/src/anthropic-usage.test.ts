import { describe, expect, it } from "vitest";
import { anthropicUsage } from "./anthropic-usage.js";

describe("anthropicUsage", () => {
  it("folds cache reads and writes into the input total and keeps them as detail", () => {
    expect(
      anthropicUsage({
        input_tokens: 5,
        output_tokens: 9,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 40,
      }),
    ).toEqual({
      input_tokens: 345,
      output_tokens: 9,
      input_tokens_details: { cached_tokens: 300, cache_write_tokens: 40 },
    });
  });

  it("leaves usage without cache fields unchanged", () => {
    expect(
      anthropicUsage({
        input_tokens: 5,
        output_tokens: 9,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
      }),
    ).toEqual({ input_tokens: 5, output_tokens: 9 });
  });

  it("ignores malformed cache counts rather than inventing input", () => {
    expect(
      anthropicUsage({ input_tokens: 5, output_tokens: 9, cache_read_input_tokens: -1 }),
    ).toEqual({ input_tokens: 5, output_tokens: 9 });
    expect(anthropicUsage(null)).toBeUndefined();
  });
});
