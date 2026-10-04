import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  formatProfileGenerationElapsed,
  formatProfileGenerationPart,
  ProfileGenerationCancel,
  ProfileGenerationProgress,
} from "./profile-generation-progress.js";

describe("formatProfileGenerationElapsed", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [5_000, "0:05"],
    [65_000, "1:05"],
    [754_000, "12:34"],
    [3_599_999, "59:59"],
    [3_600_000, "1:00:00"],
    [3_723_000, "1:02:03"],
    [-5_000, "0:00"],
    [Number.NaN, "0:00"],
    [Number.POSITIVE_INFINITY, "0:00"],
  ])("formats %s ms as %s", (ms, expected) => {
    expect(formatProfileGenerationElapsed(ms)).toBe(expected);
  });
});

describe("ProfileGenerationProgress", () => {
  const html = renderToStaticMarkup(<ProfileGenerationProgress startedAt={1_000} now={66_000} />);

  it("shows the title, the elapsed time, and the explanation", () => {
    expect(html).toContain("Generating profile…");
    expect(html).toContain("Elapsed 1:05");
    expect(html).toContain("processed in parts");
    expect(html).toContain("Keep DraftLoop open.");
  });

  it("announces once and hides the ticking elapsed time from assistive technology", () => {
    expect(html).toContain('<span class="sr-only">Generating profile.</span>');
    expect(html).toContain(
      '<span class="profile-generation-elapsed" aria-hidden="true">Elapsed 1:05</span>',
    );
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="status"');
  });

  it("claims no percentage or completion estimate", () => {
    expect(html).not.toContain("%");
    expect(html).not.toMatch(/remaining|estimate|complete/i);
  });
});

describe("ProfileGenerationProgress part progress", () => {
  const render = (progress?: { completedCalls: number; plannedCalls: number }) =>
    renderToStaticMarkup(
      <ProfileGenerationProgress
        startedAt={1_000}
        now={66_000}
        {...(progress === undefined ? {} : { progress })}
      />,
    );

  it("names the part in progress and hides it from assistive technology", () => {
    const html = render({ completedCalls: 1, plannedCalls: 4 });
    expect(html).toContain(
      '<span class="profile-generation-part" aria-hidden="true">Part 2 of 4</span>',
    );
    expect(render({ completedCalls: 0, plannedCalls: 3 })).toContain("Part 1 of 3");
  });

  it("says it is finishing once every planned call has completed", () => {
    expect(render({ completedCalls: 4, plannedCalls: 4 })).toContain("Finishing…");
    expect(render({ completedCalls: 4, plannedCalls: 4 })).not.toContain("Part ");
  });

  it("shows no part label without reported counts", () => {
    expect(render()).not.toContain("profile-generation-part");
    expect(formatProfileGenerationPart(undefined)).toBeNull();
    expect(formatProfileGenerationPart({ completedCalls: 0, plannedCalls: 0 })).toBeNull();
  });
});

describe("ProfileGenerationCancel", () => {
  it("offers Cancel generation and disables it once cancellation is requested", () => {
    const idle = renderToStaticMarkup(
      <ProfileGenerationCancel cancelling={false} onCancel={() => undefined} />,
    );
    expect(idle).toContain("Cancel generation");
    expect(idle).not.toContain("disabled");
    const cancelling = renderToStaticMarkup(
      <ProfileGenerationCancel cancelling onCancel={() => undefined} />,
    );
    expect(cancelling).toContain("Cancelling…");
    expect(cancelling).toContain('disabled=""');
  });
});
