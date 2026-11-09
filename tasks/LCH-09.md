---
id: LCH-09
title: Ready for a 1-million-person broadcast
area: LAUNCH
priority: launch (before the broadcast)
tier: T2
repo: api + web + infra
status: done
depends_on: [LCH-02, LCH-04]
decisions: [V-30]
boards: []
---
# LCH-09 · Ready for a 1-million-person broadcast

A send to 1 million people can bring tens of thousands of visits within minutes. Everything today runs on one droplet.

## Build
- A load test of the real stack on a droplet the same size: /go, the question, listening, sign-in return, posting,
  where-you-sit, share pages. Find the first thing that breaks and fix it (caching of read pages, Redis counters,
  database pool, nginx limits, image cache, Next caching).
- The sign-ups go through WAWU ID on the WAWU droplet: measure what it can take and agree the numbers with the owner
  (never load-test the live WAWU ID; use the stand-in and ask the owner for WAWU’s limits).
- A plain "We are busy, try again in a minute" page instead of errors when full.
- Recommend to the owner: send in waves (for example 100,000 an hour) and the droplet size for launch day.

## Done when
- A report with the numbers: requests a second, people at once, the slowest page, and what size of droplet is needed.
