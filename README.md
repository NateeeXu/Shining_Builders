# Shining Builders

Shining Builders is a free static website for discovering what AI builders are saying and what they are building.

Version 2.0 keeps the original builder information feed as **Builder Signals** and adds **GitHub Weekly Stars**, a daily GitHub REST API scan for fast-moving, practical AI tools, skills, agents, MCP projects, AI coding projects, RAG tools, workflow automation projects, and developer tools.

The only paid API is one optional Claude call per day that writes the Builder Signals summaries (about $0.003 a day with Claude Haiku 5.5). Without an `ANTHROPIC_API_KEY`, the site still builds and shows a rule-based summary instead. The website workflow does not use the OpenAI API.

## What It Shows

- **Builder Signals**: latest public X/Twitter builder messages, podcasts, long-form items, and blog posts from the existing follow-builders feeds, summarized at the top of the page, grouped into topics and grouped by builder.
- **GitHub Weekly Stars**: public GitHub repositories matching AI builder keywords, filtered for active non-fork, non-archived repos with meaningful stars and recent pushes.
- **Practical Tools**: high-scoring GitHub repos that look useful for builders, including AI coding, agents, MCP, workflow automation, developer tools, SaaS starter kits, and skills.
- Search, category filtering, high-score filtering, score reasons, repo metadata, topics, and source links.

## GitHub Weekly Stars

The GitHub scanner lives in `scripts/build-github-stars.js`.

It searches public repositories with keywords including:

```text
ai agent, llm agent, mcp, claude code, cursor, ai coding, coding agent, rag,
workflow automation, ai tool, llm app, openai, anthropic, langchain,
llamaindex, browser agent, developer tool, ai skill
```

The script prioritizes:

- `fork:false`
- `archived:false`
- pushed within the last 30 days
- stars greater than 20

`GITHUB_TOKEN` is optional. If present, the script adds it to the GitHub request headers for higher rate limits. If it is not present, the script still runs in unauthenticated mode with fewer grouped searches.

Generated files:

- `public/data/latest.json`
- `public/data/github-weekly.json`
- `public/data/github-stars-history.json`

`github-stars-history.json` stores the previous star count for each seen repo. On later runs, `weeklyStars` is calculated as the current star count minus the previous stored star count. First-time repos are marked as `newCandidate` and get `weeklyStars: 0`.

## Builder Signals Summaries

`scripts/build-digest.js` sends the day's posts from `public/data/latest.json` to Claude in a single request and writes `public/data/digest.json`:

- `brief`: two sentences on what dominated the day, shown at the top of the page.
- `themes`: 2-4 topics several posts share, each with a one-sentence summary and the ids of its posts. Clicking a topic filters the list to those posts.
- `builders`: one or two sentences per builder, shown above their posts.

Settings (environment variables):

- `ANTHROPIC_API_KEY`: required. In GitHub, add it under `Settings` > `Secrets and variables` > `Actions` > `Repository secrets`.
- `DIGEST_MODEL`: defaults to `claude-haiku-5-5`.
- `DIGEST_LANGUAGE`: defaults to `English`. Set it to `Chinese` for Chinese summaries.

The script never fails the build. If the key is missing or rejected, or the request fails, it logs a warning and exits normally. The page only uses `digest.json` when its `sourceGeneratedAt` matches the `generatedAt` of `latest.json`; otherwise it falls back to the rule-based summary, so an old digest is never shown next to newer posts.

## Local Run

From the repo root:

```bash
cd scripts
npm install
cd ..
node scripts/build-site.js
node scripts/build-github-stars.js
ANTHROPIC_API_KEY=your-key node scripts/build-digest.js   # optional
```

Optional syntax check:

```bash
node --check scripts/build-github-stars.js
```

The static site is written under `public/`. You can serve that folder with any static server, or open `public/index.html` directly if your browser allows local `fetch`.

## Deploy To GitHub Pages

The default workflow is `.github/workflows/daily-site.yml`.

It runs every day at `00:00 UTC`, which is `08:00` in Beijing, and can also be started manually with `workflow_dispatch`.

The workflow:

1. Checks out the repo.
2. Sets up Node.js.
3. Installs script dependencies.
4. Runs `node scripts/build-site.js`.
5. Runs `node scripts/build-github-stars.js` with the GitHub Actions `GITHUB_TOKEN`.
6. Runs `node scripts/build-digest.js` with the `ANTHROPIC_API_KEY` repository secret. If this step fails, the rest of the workflow still runs.
7. Commits generated data and static files.
8. Deploys `public/` to GitHub Pages.

To enable GitHub Pages:

1. Open the repository `Settings`.
2. Open `Pages`.
3. Set `Source` to `GitHub Actions`.
4. Run the `Daily Shining Builders Site` workflow once, or wait for the daily schedule.

## Scripts

- `scripts/prepare-digest.js` fetches the latest follow-builders feed JSON.
- `scripts/build-site.js` builds Builder Signals and writes the static HTML shell.
- `scripts/build-github-stars.js` builds GitHub Weekly Stars and updates star history.
- `scripts/build-digest.js` writes the Claude summaries for Builder Signals.
- `scripts/summarize.js` is retained only for the optional Feishu digest flow.

## Optional Feishu Flow

`.github/workflows/daily-feishu.yml` is kept as a manual-only optional workflow. It is not the default daily website workflow and still requires OpenAI plus Feishu secrets if you choose to run it.

For the website, use `Daily Shining Builders Site`.

## License

MIT
