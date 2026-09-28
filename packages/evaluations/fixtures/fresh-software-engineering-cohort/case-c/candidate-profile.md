# Nera Vale

<!-- evidence-id: c-contact -->
**Contact**: `nera.vale@profile.test` · North Basin, fictional region

## Profile

<!-- evidence-id: c-summary -->
Software engineer focused on data ingestion and reliability. Experience includes
consulting delivery for a named client, team-operated production systems, and an
independent staging prototype. The source does not establish organization-wide
platform ownership.

## Employment

<!-- evidence-id: c-role-1 -->
### Ternfall Municipal Archive — Software Engineer — January 2016 to March 2019

Maintained a record-indexing service used by the archive's staff. Added a parser
for batch imports and retry handling for malformed records. The service ran in
production under the archive operations group; Nera contributed code but did
not own the service or its deployment.

<!-- evidence-id: c-gap-1 -->
### Employment gap — April 2019 to February 2020

No software employment is listed for this interval.

<!-- evidence-id: c-role-2 -->
### Larkspur Data Works — Consultant, Integration Engineer — March 2020 to November 2023

Larkspur employed Nera as a consultant. Client: Selwick Watershed Authority.
Nera wrote the Rust **Driftglass Bridge** adapter that converted the client's
TideLedger sensor packets into a Nacre Batch queue, adding bounded retries and
duplicate suppression. A four-person delivery team integrated the adapter. The
client reliability group approved and performed production deployment; Nera did
not own service operations or the rollout.

In a fixed replay benchmark using the same 8,000 packets, measured P95 processing
time fell from 11.2 seconds to 7.4 seconds. This is a benchmark result, not a
production service-level claim.

<!-- evidence-id: c-study-2 -->
### Storage study during the Larkspur engagement

Compared an object-store archive with an append-only log and presented a
migration recommendation. The proposed migration was not executed.

<!-- evidence-id: c-role-3 -->
### Skymoor Cartography — Software Engineer — December 2023 to present

Works on a data-quality API with a platform team. Co-authored replay checks and
release handoff notes; the platform team operates the production API and owns
its roadmap. No cloud-provider or Kubernetes operations responsibility is
recorded.

## Independent project

<!-- evidence-id: c-project-1 -->
### Thistle Relay — January 2024 to present

Built a staging prototype that simulates retry behavior for map-tile imports.
It has no production users and no independently measured scale or performance
result.

## Education and training

<!-- evidence-id: c-education -->
BSc in Geoinformatics, Northline Polytechnic, 2015.

<!-- evidence-id: c-training -->
Completed the Bramble Institute Distributed Log Operations workshop in 2021.
The document is a certificate of attendance, not a professional certification.

## Skills

<!-- evidence-id: c-skills -->
Rust, SQL, queue processing, retry design, data validation, technical writing,
and replay testing.

## Languages

<!-- evidence-id: c-languages -->
English — fluent; Swedish — basic.
