# CareerPilot Job Radar (MVP starter)

A browser-first TypeScript app for discovering potentially relevant jobs, explaining preliminary matches, saving original listing URLs, and tracking application stages.

## Nebius x NVIDIA hackathon notes

- **Track:** Best Apps and Agents.
- **NVIDIA model:** NVIDIA Nemotron (`nvidia/nemotron-3-super-120b-a12b` by default) is used in three places, all through Nebius Token Factory:
  1. **Resume → career profile** (`api/extract-profile.ts`): reads pasted resume text and returns target roles, skills, education and location as structured JSON. Falls back to the local rule-based extractor if the model is unavailable.
  2. **Search planning** (`api/search-jobs.ts`): turns the profile into three complementary web-search queries (main title, adjacent titles, employer/ATS pages) before calling Tavily. Falls back to rule-based queries; the UI shows which queries were used and who planned them.
  3. **Per-job explanation** (`api/analyze-job.ts`): explains strengths, gaps and what to verify for one listing.
- **Nebius Token Factory:** `api/analyze-job.ts` makes a runtime call to the Token Factory OpenAI-compatible chat-completions API. The key is held server-side on Vercel.
- **Tavily:** `api/search-jobs.ts` makes runtime calls to the Tavily Search API to find public job listings.
- **Privacy:** the profile and saved jobs stay in the browser; resume text is sent to the model only on explicit opt-in.
- **Updated during the submission period:** the project was built from a starter during the period (Vercel serverless functions, Tavily search, Nemotron explanations, tests, bug fixes).
- **License:** MIT (see `LICENSE`).

## Current scope

- Career profile: target titles, skills, location, work mode, pasted resume/experience text, and education. A local heuristic extractor suggests common skills and likely role/education lines for the user to review.
- **CV upload:** upload a PDF, DOCX or TXT CV (max 5 MB). The text is extracted in the browser with pdf.js and mammoth; the file itself is never uploaded. Scanned/image-only CVs are not supported (paste the text instead).
- **Mandatory time window:** every search requires one of Last 1 day (24h), 1 week, 2 weeks, 3 weeks or 4 weeks. There is no "all time" option; the server rejects requests without a valid window.
- **Strict recency:** a listing is shown only if its posting date can be verified (search-provider date, schema.org `datePosted`, or text such as "Posted 3 days ago") and falls inside the window. Listings with no verifiable date are hidden and counted ("Hidden: N without a verifiable posting date"). This favours correctness over volume, so some searches return few results.
- **Worldwide, multi-place location search:** pick up to 5 cities or countries from a searchable dropdown (about 23,600 places with 15,000+ inhabitants plus every country; accents and common alternative names such as Bangalore/Bengaluru are understood; “City, Country” works, and any text can be added as a custom place). Each place is searched separately and a listing scores location points if it mentions any selected place.
- **User-selected sources only (about 90 job sites):** choose from a grouped, searchable list (Global, India, United States & Canada, United Kingdom & Ireland, Europe, Middle East & Africa, Asia-Pacific, Latin America, remote and startup boards, and employer career sites on Greenhouse, Lever, Workday, Ashby and others). Only ticked sources are searched and results from any other site are dropped. At least one source is required.
- Search across public web results using Tavily through a Vercel Function.
- At most eight bounded Tavily calls per click. Ticked sites are grouped (about four per call) and each group is searched once per selected place; with many places and sites the groups are merged, so everything selected is still covered but with fewer result slots per site; duplicates are removed and original URLs are preserved.
- Local keyword-based ranking with visible matching terms and skills not found in the snippets.
- **Optional AI explanation (NVIDIA Nemotron on Nebius Token Factory).** Each result has an "Explain with Nemotron" button. A server-side function (`api/analyze-job.ts`) sends the listing snippet plus your target roles, skills, location and education to a Nemotron model and shows strengths, possible gaps and things to verify. Your pasted resume text is sent only if you tick the opt-in box in the profile panel. The AI text is advisory and never changes the keyword match percentage.
- Save jobs, track `Saved / Applied / Interview / Offer / Rejected`, add a job URL manually, and export/import a JSON backup.
- Profile and saved jobs are stored in browser `localStorage`.
- The pasted resume/experience text and education field are never sent to the search endpoint. The search request includes target roles, skills, location, and work mode. Resume extraction is a simple local dictionary/rule-based suggestion, not a full resume parser; users should review its output.
- If the search API is not configured or running, the app presents direct links to public job search pages.

## Requirements

- Node.js 20.19+ recommended (or a compatible current LTS release)
- npm
- (Optional but recommended) A Nebius Token Factory API key for the Nemotron features (profile extraction, search planning, explanations). Default model: `nvidia/nemotron-3-super-120b-a12b`; override with `NEBIUS_MODEL`.
- A Tavily API key for results to appear inside the app. Tavily currently advertises a free Researcher plan with 1,000 API credits/month and no credit card required; confirm current limits and terms on its website.

## Run locally

```bash
npm install
```

For the UI alone (the search API route will not be present):

```bash
npm run dev
```

For the UI plus the serverless function, use the Vercel CLI (`npx vercel dev`; the first run asks you to log in and link the project). Put the key in a git-ignored `.env.local` file:

```bash
echo 'TAVILY_API_KEY=your_key_here' > .env.local
npx vercel dev
```

Open the local address the CLI prints. Never put the real key in frontend code, `VITE_*` variables, or a committed file.

## Deploy to Vercel

1. Push this folder to a new GitHub repository.
2. In Vercel choose **Add New → Project** and import the repository. The framework preset is detected as Vite; `vercel.json` already declares build command `npm run build`, output directory `dist`, and a 30-second limit for the function.
3. Under **Settings → Environment Variables** add `TAVILY_API_KEY` (Production and Preview) with your Tavily key, and `NEBIUS_API_KEY` for the Nemotron features. Optional: `NEBIUS_MODEL` (default `nvidia/nemotron-3-super-120b-a12b`) and `NEBIUS_BASE_URL` (default `https://api.tokenfactory.nebius.com/v1`).
4. Deploy (or redeploy after adding the variable). The function in `api/search-jobs.ts` reads the key server-side; it is not bundled into the browser app.
5. Test search, add/save, refresh persistence, update application status, and backup/restore on the deployed site.

Without `NEBIUS_API_KEY` the AI buttons show a not-configured message, extraction and search planning fall back to rule-based logic, and nothing else breaks. Without `TAVILY_API_KEY` the app still works: search shows a friendly message and the direct-search links, and you can add job URLs manually.

## Tests and build

```bash
npm test
npm run build
```

## Data attribution

Place names come from [GeoNames](https://www.geonames.org), licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/), via the `all-the-cities` and `country-list` npm packages (MIT). To regenerate `src/data/places.json`, run `npm install --no-save all-the-cities country-list` and then `node scripts/build-places.mjs`.

## Important limitations before a public launch

- Matching is a transparent **keyword-overlap estimate** based on a search result's title, URL and short snippet. It is not an AI assessment, a probability of being hired, or a guarantee that the role is open. Users should visit the original listing and verify details.
- Portals are searched through public search-engine results (Tavily), not by logging in to or scraping them, and coverage of each portal is partial. Always open the original listing to confirm it is still open.
- Search results can include category pages, expired listings, or related pages, not only active vacancies. The app labels results as potential listings rather than claiming every result is verified.
- The current MVP sends only target role titles, selected skills, location, and work preference to Tavily. Query planning sends the same roles, skills, location and work mode to the Nebius-hosted model. "Extract profile with Nemotron AI" sends the pasted resume text, only when you click it. When you click "Explain with Nemotron", the listing snippet, your roles, skills, location and education go to the Nebius-hosted model, and your resume text too only if you opt in. This means those search terms leave the device. Do not send full resume text or personal contact information to the search provider.
- Add server-side rate limiting, caching, usage monitoring, provider attribution/terms review, abuse protection, and a privacy notice before opening the API endpoint to the public. This starter limits a click to three basic searches but is not a complete abuse-prevention system.
- The app has no authentication or cloud sync; data is local to the browser profile. Users should export a backup before clearing browser storage.
- Direct website scraping, automatic form filling, and automated applications are deliberately not included.

## Project structure

```text
src/
  App.tsx                 UI and local job tracking
  lib/types.ts            Shared type definitions
  lib/matcher.ts          URL normalization, simple matching, fallback links
  lib/cv.ts               Browser-side CV text extraction (PDF, DOCX, TXT)
  lib/window.ts           Time-window options for the UI
  lib/locations.ts        Worldwide place search (cities and countries)
  components/             LocationPicker and SourcePicker multi-selects
  data/places.json        Generated place data (GeoNames, CC BY 4.0)
  test/matcher.test.ts    Matcher tests
  styles.css              Responsive UI styles
lib/
  sources.ts              Catalogue of job sites and their domains (shared by browser and server)
  recency.ts              Server-side posting-date detection, time windows, portal domains
api/
  search-jobs.ts          Vercel Function: server-side Tavily search proxy
  analyze-job.ts          Vercel Function: Nemotron (Nebius) match explanation
  extract-profile.ts      Vercel Function: Nemotron (Nebius) resume → profile
tests/
  analyze-job.test.ts     Tests for the AI functions and query planner (mocked providers)
  extract-profile.test.ts
  search-jobs.test.ts
  recency.test.ts
vercel.json               Build and function configuration
```
