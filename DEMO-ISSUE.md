# Demo issue for Shadow Patch (do not fix by hand)

Title: Preferred location "Mumbai, India" gives no location credit to jobs that say "Mumbai"

The matcher only gives the 15 location points when the whole preferred-location string appears in the listing text. A profile location written as "City, Country" therefore never matches a listing that only names the city, so good local jobs score lower and can drop out of the Strong / Possible filters.

Example (function `scoreJob` in `src/lib/matcher.ts`):

- profile: targetRoles "Supply Chain Manager", skills "", location "Mumbai, India", all other fields empty
- job: title "Supply Chain Manager — Mumbai", url "https://jobs.example.com/scm", content "Apply now"
- actual matchScore: 50
- expected matchScore: 65 (the same job with profile location "Mumbai" already scores 65)

How to see it in the app (no API key needed): set Target job titles to "Supply Chain Manager" and Preferred location to "Mumbai, India", click "Add URL", and save a job titled "Supply Chain Manager" with location "Mumbai". The badge shows 50% instead of 65%.

Suggested scope for patchproof.json: allowed_paths `src/lib/matcher.ts`.

Note for the hackathon write-up: the AI explanation uses NVIDIA Nemotron via Nebius Token Factory, but it does not feed the score. The bug above is in the deterministic matcher, so the Shadow Patch demo is unaffected by whether `NEBIUS_API_KEY` is set.
