/**
 * The size in pixels of each public guide screenshot in `public/guide/images/`, so the page
 * reserves its space before it loads. Taken on a local demo workspace with fictional data;
 * `guide-page.test.ts` checks that each section's pictures are listed here.
 */
export const guideImageSizes: Readonly<Record<string, readonly [number, number]>> = {
  "agents.en.webp": [1400, 363],
  "agents.fr.webp": [1400, 392],
  "display.en.webp": [1400, 217],
  "display.fr.webp": [1400, 217],
  "draft.en.webp": [1400, 217],
  "draft.fr.webp": [1400, 217],
  "evidence.en.webp": [1400, 354],
  "evidence.fr.webp": [1400, 354],
  "job.en.webp": [1320, 1788],
  "job.fr.webp": [1320, 1832],
  "prepare.en.webp": [1400, 858],
  "prepare.fr.webp": [1400, 858],
  "review.en.webp": [798, 2024],
  "review.fr.webp": [798, 2058],
};
