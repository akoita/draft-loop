# Software-grounding generalization baseline

This fixture records how the current local author validator handles seven
fictional pairs: unfamiliar technology and paraphrase, consultant/client
attribution, study versus implementation, shared contribution versus
ownership, staging versus production, separated career periods, and course
versus certification scope. The authored source expectation for each claim is
in [cases.json](cases.json); the observed validator result is recorded
separately in [baseline.json](baseline.json).

Run the provider-free baseline check from the repository root:

```sh
pnpm exec vitest run packages/application/src/software-grounding-baseline.test.ts --maxWorkers=1 --reporter=verbose
```

The test sends each fictional claim through the existing local replay/build
boundary. The committed observations are current behavior, not target behavior:
two source-supported claims are rejected, while five contradicted semantic
claims are accepted and would need independent critique. Deterministic date
range controls remain rejected. No model is called, no product outcome is
measured, and no held-out profile is represented.

This small set identifies failure types; it cannot establish generalization.
Technical keywords can help describe a source, but reliability cannot depend
on anticipating every language, tool, or scenario in a closed vocabulary.
Semantic distinctions such as employer attribution, work maturity, ownership,
or credential scope require evidence-aware review beyond lexical overlap.
