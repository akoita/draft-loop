# Software-grounding generalization baseline

This fixture records how the local author validator handled seven
fictional pairs: unfamiliar technology and paraphrase, consultant/client
attribution, study versus implementation, shared contribution versus
ownership, staging versus production, separated career periods, and course
versus certification scope. The authored source expectation for each claim is
in [cases.json](cases.json); the observed validator result is recorded
separately in [baseline.json](baseline.json).

Run the provider-free historical-baseline and target-behavior checks from the repository root:

```sh
pnpm exec vitest run packages/application/src/software-grounding-baseline.test.ts --maxWorkers=1 --reporter=verbose
```

`baseline.json` is an immutable snapshot of the initial observations, not a
statement of current behavior. The test preserves its two supported false
rejections and five contradicted semantic admissions, then replays the two
supported multiword examples through the current local build boundary. Their
same-chunk whole-word support now passes deterministic grounding; the independent
critic must still assess meaning. No model is called, no product outcome is
measured, and no held-out profile is represented.

This small set identifies failure types; it cannot establish generalization.
Technical keywords can help describe a source, but reliability cannot depend
on anticipating every language, tool, or scenario in a closed vocabulary.
Semantic distinctions such as employer attribution, work maturity, ownership,
or credential scope require evidence-aware review beyond lexical overlap.
