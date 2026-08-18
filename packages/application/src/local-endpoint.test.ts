import { describe, expect, it } from "vitest";

import { isLoopbackEndpoint } from "./local-endpoint.js";

describe("local model endpoint safety", () => {
  it("accepts the loopback forms a local inference server actually listens on", () => {
    // llama.cpp's default, Ollama's default, and an IPv6-only host.
    expect(isLoopbackEndpoint("http://127.0.0.1:8080/v1")).toBe(true);
    expect(isLoopbackEndpoint("http://localhost:11434/v1")).toBe(true);
    expect(isLoopbackEndpoint("http://[::1]:8080/v1")).toBe(true);
    expect(isLoopbackEndpoint("https://127.0.0.1:8443/v1")).toBe(true);
    expect(isLoopbackEndpoint("http://127.9.9.9:8080/v1")).toBe(true);
  });

  it("refuses hosts that would send candidate material off this machine", () => {
    expect(isLoopbackEndpoint("http://api.openai.com/v1")).toBe(false);
    expect(isLoopbackEndpoint("https://198.51.100.7:8080/v1")).toBe(false);
    expect(isLoopbackEndpoint("http://192.168.1.4:8080/v1")).toBe(false);
    expect(isLoopbackEndpoint("http://0.0.0.0:8080/v1")).toBe(false);
  });

  it("refuses schemes that are not http traffic to a server", () => {
    expect(isLoopbackEndpoint("file:///etc/passwd")).toBe(false);
    expect(isLoopbackEndpoint("ftp://127.0.0.1/v1")).toBe(false);
    expect(isLoopbackEndpoint("ws://127.0.0.1:8080/v1")).toBe(false);
  });

  it("refuses input that is not a URL at all", () => {
    expect(isLoopbackEndpoint("not a url")).toBe(false);
    expect(isLoopbackEndpoint("")).toBe(false);
    expect(isLoopbackEndpoint("127.0.0.1:8080")).toBe(false);
    expect(isLoopbackEndpoint("//127.0.0.1/v1")).toBe(false);
  });

  it("refuses hosts dressed up to read as loopback", () => {
    // The authority here is evil.test; "127.0.0.1" is only a username.
    expect(isLoopbackEndpoint("http://127.0.0.1@evil.test/v1")).toBe(false);
    expect(isLoopbackEndpoint("http://[::1]@evil.test/v1")).toBe(false);
    expect(isLoopbackEndpoint("http://localhost.evil.test/v1")).toBe(false);
    expect(isLoopbackEndpoint("http://127.0.0.1.evil.test/v1")).toBe(false);
    // A loopback host does not need credentials, so refuse the shape outright
    // rather than teach readers that credentials before an "@" are harmless.
    expect(isLoopbackEndpoint("http://user:pass@127.0.0.1:8080/v1")).toBe(false);
  });

  it("judges the host the URL parser resolves, not the text the user typed", () => {
    // Shorthand and integer IPv4 forms normalize to 127.0.0.1 before we look.
    expect(isLoopbackEndpoint("http://127.1:8080/v1")).toBe(true);
    expect(isLoopbackEndpoint("http://2130706433:8080/v1")).toBe(true);
    expect(isLoopbackEndpoint("http://LOCALHOST:8080/v1")).toBe(true);
    // IPv4-mapped IPv6 normalizes to ::ffff:7f00:1, which this deliberately
    // narrow rule does not recognize; the plain forms above are the way in.
    expect(isLoopbackEndpoint("http://[::ffff:127.0.0.1]:8080/v1")).toBe(false);
  });
});
