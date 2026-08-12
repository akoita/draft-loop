# Security policy

DraftLoop handles sensitive career history and may process confidential
employer information. The default design is local-first: source files,
evidence links, drafts, and run history should remain local unless the user
explicitly enables a provider and accepts its data policy.

Please do not report a vulnerability in a public issue. Until a dedicated
security contact is configured, contact the repository maintainers privately
with a clear description, affected files or versions, reproduction steps, and
any safe mitigation. Do not include real candidate data or credentials in a
report.

Contributors must avoid committing secrets, personal source documents, provider
responses containing sensitive data, or local database files. Security fixes
should include a regression test where practical and document any changed
retention or external-data behavior.
