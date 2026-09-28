# Candidate profile: Nila Ardent

Profile facts last reviewed September 2025. Dates below describe separate
employment periods; gaps are intentionally stated rather than inferred.

<!-- evidence-id: a-contact -->
## Contact

Contact: Nila Ardent | Email: `n.ardent@nilaar.test` | Phone: +1 202-555-0147 | Profile: `https://profiles.test/nila-ardent`

<!-- evidence-id: a-education -->
## Education

Bachelor of Engineering in Software Systems, Westmere Institute of Applied
Computing, completed 2017.

<!-- evidence-id: a-languages -->
## Languages

English: native. French: B2, self-assessed in 2025.

<!-- evidence-id: a-training -->
## Training

Completed the Stream Processing Workshop in 2022. The organizer issued a
certificate of attendance; there was no exam, vendor credential, or professional
certification.

<!-- evidence-id: a-employment-1 -->
## Bright Silt Consulting · Software Consultant · Jan 2018 to Jun 2020

Bright Silt Consulting was my employer. From Feb 2019 through May 2020 I was
assigned as a consultant to the Marrow County Mobility Office, which owned the
existing DispatchLoom timetable service and made its production-release
decisions. I did not work for the county or create its service.

<!-- evidence-id: a-dispatchloom -->
For that client assignment, I maintained DispatchLoom's existing Kotlin feed
adapter, added retry handling for delayed route updates, and wrote contract
tests with county engineers. The county team deployed the changes. During a
three-week measurement window, median feed reconciliation fell from 11 minutes
to 7 minutes; this was a service metric, not an uptime or service-level claim.

<!-- evidence-id: a-micashore-study -->
In 2020 I compared PostgreSQL range partitioning with a proposed append-only
store called MicaShore. I authored a design study and a small local benchmark;
the team selected no option, and no data migration or production implementation
followed.

<!-- evidence-id: a-gap-1 -->
## Employment gap · Jul 2020 to Feb 2021

No employment is recorded for this period.

<!-- evidence-id: a-employment-2 -->
## Fable Current Systems · Backend Engineer · Mar 2021 to Oct 2024

Worked on SiltWeave, the company's production order-event service, with a team
of six backend engineers. The company released and operated the service; I was
not its sole designer or owner.

<!-- evidence-id: a-siltweave -->
I implemented a Kotlin event de-duplication worker and a replay endpoint backed
by PostgreSQL, including idempotency checks and retry tests. I also added a
reconciliation dashboard used during an incident review. The on-call team
identified and corrected a separate database-locking issue; I added its
regression test, but did not claim sole incident resolution.

<!-- evidence-id: a-gap-2 -->
## Employment gap · Nov 2024 to Feb 2025

No employment is recorded for this period.

<!-- evidence-id: a-independent -->
## Independent project · TernSpindle · Mar 2025 to Aug 2025

Built TernSpindle, a Go prototype for inspecting synthetic event replays. It
ran only in a local staging setup with sample data: it had no production users,
customer deployment, or scale measurement. This was personal work, not a Fable
Current Systems project or employment.
