#!/usr/bin/env node

// ============================================================================
// Shining Builders - daily Builder Signals digest (Claude)
// ============================================================================
// Reads public/data/latest.json (written by build-site.js), asks Claude to
// summarize the day's posts, and writes public/data/digest.json.
//
// One request per run. Needs ANTHROPIC_API_KEY; without it, or if the call
// fails, the script logs why and exits 0 so the daily build still deploys.
// The site checks that digest.json matches latest.json and otherwise falls
// back to its rule-based summary.
//
// Env:
//   ANTHROPIC_API_KEY   required to run
//   DIGEST_MODEL        default claude-haiku-5-5
//   DIGEST_LANGUAGE     default English
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(SCRIPT_DIR, '..', 'public', 'data');
const LATEST_JSON_PATH = join(DATA_DIR, 'latest.json');
const DIGEST_JSON_PATH = join(DATA_DIR, 'digest.json');

const MODEL = process.env.DIGEST_MODEL || 'claude-haiku-5-5';
const LANGUAGE = process.env.DIGEST_LANGUAGE || 'English';

// The feed is usually 20-40 posts. Cap it so an unusually busy day can't
// produce an oversized request; the highest-scored posts are kept.
const MAX_POSTS = 80;

const DigestSchema = z.object({
  brief: z.string(),
  themes: z.array(z.object({
    label: z.string(),
    summary: z.string(),
    post_ids: z.array(z.string())
  })),
  builders: z.array(z.object({
    name: z.string(),
    summary: z.string()
  }))
});

const SYSTEM_PROMPT = `You write the daily digest for Shining Builders, a site that tracks what AI builders post on X and in podcasts. Readers are builders who want the gist of the day in under a minute, then click through to the posts that interest them.

Write in ${LANGUAGE}. Use only what the posts say: no outside facts, predictions or opinions of your own. Name products, companies and people exactly as the posts do. Write plain, specific sentences. No hype words, emoji or hashtags.

Fill in:
- brief: 2 sentences, under 45 words, on what dominated today's posts and the most notable thing beyond it.
- themes: 2-4 topics that several posts share, most discussed first. label names the topic in 2-5 words (a product, launch or idea). summary is one sentence, under 25 words, on what builders said about it. post_ids lists the ids of the posts about it; a theme needs at least 2.
- builders: one entry for each builder in the input, in the same order. name is copied exactly from the input. summary is 1-2 sentences, under 40 words, on what they posted, led by their most substantive post. If all their posts are personal or minor, say that in a few words.`;

function log(message) {
  console.error(`[build-digest] ${message}`);
}

function warn(message) {
  // Shows up as an annotation in the GitHub Actions run summary.
  console.error(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[build-digest] warning: ${message}`);
}

function decodeEntities(value) {
  const map = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&nbsp;': ' ' };
  return String(value ?? '').replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (entity) => map[entity] ?? entity);
}

function builderName(item) {
  return decodeEntities(item.author || item.source || 'Unknown').trim();
}

function postText(item) {
  const title = decodeEntities(item.title || '').trim();
  const body = decodeEntities(item.text || item.summary || '').replace(/\s+/g, ' ').trim();
  // Podcast and blog titles carry information the excerpt doesn't.
  return item.type !== 'tweet' && title ? `${title}\n${body}` : body;
}

function buildInput(items) {
  const posts = items.map((item) => ({
    id: item.id,
    builder: builderName(item),
    type: item.type === 'tweet' ? 'X post' : item.type,
    category: item.category,
    likes: item.likes ?? null,
    text: postText(item)
  }));

  const builders = [...new Set(posts.map((post) => post.builder))];

  return [
    `Builders, in order: ${JSON.stringify(builders)}`,
    '',
    '<posts>',
    JSON.stringify(posts, null, 1),
    '</posts>'
  ].join('\n');
}

function clean(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Keep only what can be matched back to real posts and builders.
function validate(parsed, items) {
  const ids = new Set(items.map((item) => item.id));
  const names = new Set(items.map(builderName));

  const themes = parsed.themes
    .map((theme) => ({
      label: clean(theme.label, 60),
      summary: clean(theme.summary, 240),
      postIds: [...new Set(theme.post_ids.filter((id) => ids.has(id)))]
    }))
    .filter((theme) => theme.label && theme.postIds.length >= 2)
    .slice(0, 4);

  const seen = new Set();
  const builders = parsed.builders
    .map((builder) => ({ name: clean(builder.name, 80), summary: clean(builder.summary, 320) }))
    .filter((builder) => names.has(builder.name) && builder.summary && !seen.has(builder.name) && seen.add(builder.name));

  const brief = clean(parsed.brief, 480);
  if (!brief) throw new Error('response had an empty brief');

  return { brief, themes, builders };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    warn('ANTHROPIC_API_KEY is not set; skipping the Claude digest. The site will use its rule-based summary.');
    return;
  }

  const latest = JSON.parse(await readFile(LATEST_JSON_PATH, 'utf-8'));
  const items = (latest.items || []).slice(0, MAX_POSTS);
  if (!items.length) {
    warn('latest.json has no posts; skipping the Claude digest.');
    return;
  }

  log(`Summarizing ${items.length} posts with ${MODEL} (${LANGUAGE})...`);

  const client = new Anthropic({ timeout: 120_000 });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildInput(items) }],
    output_config: {
      // A short summarization task: low effort keeps thinking (and cost) small.
      effort: 'low',
      format: zodOutputFormat(DigestSchema)
    }
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined the request (${response.stop_details?.category ?? 'no category'})`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('response hit max_tokens before finishing');
  }
  if (!response.parsed_output) {
    throw new Error('response did not match the digest schema');
  }

  const digest = validate(response.parsed_output, items);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: latest.generatedAt,
    model: MODEL,
    language: LANGUAGE,
    ...digest
  };

  await writeFile(DIGEST_JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  const usage = response.usage || {};
  log(`Wrote ${DIGEST_JSON_PATH}: ${digest.themes.length} themes, ${digest.builders.length} builder summaries.`);
  log(`Tokens: ${usage.input_tokens ?? '?'} input, ${usage.output_tokens ?? '?'} output.`);
}

main().catch((error) => {
  if (error instanceof Anthropic.AuthenticationError) {
    warn('Claude digest skipped: ANTHROPIC_API_KEY was rejected. Check the repository secret.');
  } else if (error instanceof Anthropic.RateLimitError) {
    warn(`Claude digest skipped: rate limited (${error.message}).`);
  } else if (error instanceof Anthropic.APIError) {
    warn(`Claude digest skipped: API error ${error.status ?? ''} ${error.message}`);
  } else {
    warn(`Claude digest skipped: ${error.message}`);
  }
  // Exit 0 on purpose: the rest of the daily build should still deploy.
});
