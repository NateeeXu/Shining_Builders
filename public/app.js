const DATA_PATHS = {
  signals: './data/latest.json',
  repos: './data/github-weekly.json',
  history: './data/github-stars-history.json',
  digest: './data/digest.json'
};
const ALL_CATEGORY = 'All';
const HIGHLIGHTS_CATEGORY = 'Highlights';
const REPO_PAGE_SIZE = 20;
const PRACTICAL_CATEGORIES = new Set([
  'AI Coding',
  'Agents',
  'MCP',
  'Workflow',
  'Developer Tools',
  'SaaS Starter Kits',
  'Skills'
]);
const TIME_ZONE = 'Asia/Shanghai';

// Words that can't be a "topic of the day" on their own.
const THEME_STOPWORDS = new Set(`
a an the and or but if of to in on at for with from by as is are was were be been being
it its it's it’s this that these those i we you he she they my our your their me us them his her
not no so just than then there here what when where who why how all any each more most some such
very can will would should could do does did done have has had also into about over out up down
one two get got make made like really today tonight now via amp rt i'm i’m we're we’re you're you’re
they're they’re don't don’t can't can’t that's that’s let's let’s we've we’ve yes yeah oh lol btw psa
ever every much many way thing things people time year years day days week weeks first last next
going go know think see want need use using used still even back right good great best big better
only own same other another ago instead actually because before after far through across seen
read check getting understand complete version project output era design cloud breaking huge
monday tuesday wednesday thursday friday saturday sunday january february march april may june
july august september october november december
ai agi model models coding code agent agents work working build building built product products
team teams company companies startup startups founder founders launch launched release released
feature features app apps users user world future thanks thank software computer new
`.trim().split(/\s+/));

const state = {
  signals: null,
  repos: null,
  history: null,
  digest: null,
  signalsCategory: ALL_CATEGORY,
  signalsTheme: null,
  signalsQuery: '',
  signalsHighScoreOnly: false,
  reposCategory: ALL_CATEGORY,
  reposQuery: '',
  reposHighScoreOnly: false,
  reposLimit: REPO_PAGE_SIZE,
  errors: []
};

function getElement(...selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }

  return document.createElement('div');
}

const els = {
  todayDate: getElement('#todayDate'),
  lastUpdated: getElement('#lastUpdated'),
  feedNotice: getElement('#feedNotice'),
  navSignalsCount: getElement('#navSignalsCount'),
  navReposCount: getElement('#navReposCount'),
  navToolsCount: getElement('#navToolsCount'),
  leadSignal: getElement('#leadSignal'),
  signalsOverview: getElement('#signalsOverview'),
  signalsCategoryTabs: getElement('#signalsCategoryTabs', '#categoryTabs'),
  signalsSearchInput: getElement('#signalsSearchInput', '#searchInput'),
  signalsHighScoreOnly: getElement('#signalsHighScoreOnly', '#highScoreOnly'),
  signalsThreshold: getElement('#signalsThreshold'),
  signalsResultsMeta: getElement('#signalsResultsMeta', '#resultsMeta'),
  signalsGrid: getElement('#signalsGrid', '#itemsGrid'),
  reposCategoryTabs: getElement('#reposCategoryTabs'),
  reposSearchInput: getElement('#reposSearchInput'),
  reposHighScoreOnly: getElement('#reposHighScoreOnly'),
  reposThreshold: getElement('#reposThreshold'),
  reposResultsMeta: getElement('#reposResultsMeta'),
  reposGrid: getElement('#reposGrid'),
  reposMoreRow: getElement('#reposMoreRow'),
  reposShowing: getElement('#reposShowing'),
  reposMoreButton: getElement('#reposMoreButton'),
  toolsGrid: getElement('#toolsGrid')
};

/* ---------- Text helpers ---------- */

const ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#039;': "'",
  '&nbsp;': ' '
};

// Some feed text arrives already HTML-encoded (e.g. "&amp;"). Decode the
// common entities first so escaping doesn't show them literally.
function decodeEntities(value) {
  return String(value ?? '').replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (entity) => ENTITY_MAP[entity] ?? entity);
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function text(value) {
  return escapeHTML(decodeEntities(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Wrap the first occurrence of each matched keyword in <mark>, so readers can
// see what the ranking picked up on. Longer phrases win ("claude code" before "claude").
function markKeywords(value, keywords) {
  const source = decodeEntities(value);
  const terms = unique((keywords || []).map((keyword) => String(keyword).trim().toLowerCase()))
    .filter((keyword) => keyword.length > 1)
    .sort((a, b) => b.length - a.length);

  if (!terms.length) return escapeHTML(source);

  const pattern = new RegExp(`\\b(${terms.map(escapeRegExp).join('|')})\\b`, 'gi');
  const seen = new Set();
  let output = '';
  let cursor = 0;

  for (const match of source.matchAll(pattern)) {
    const key = match[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output += `${escapeHTML(source.slice(cursor, match.index))}<mark>${escapeHTML(match[0])}</mark>`;
    cursor = match.index + match[0].length;
  }

  return output + escapeHTML(source.slice(cursor));
}

function dataUrl(path) {
  return new URL(path, window.location.href);
}

function getError(source) {
  return state.errors.find((error) => error.source === source);
}

function getErrorMessage(source, fallback) {
  const error = getError(source);
  return error ? `${error.message} (${error.url})` : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return 'Unknown time';

  return new Intl.DateTimeFormat('en', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function formatLongDay(value) {
  const date = toDate(value);
  if (!date) return '';

  return new Intl.DateTimeFormat('en', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

function formatClock(value) {
  const date = toDate(value);
  if (!date) return '';

  return new Intl.DateTimeFormat('en', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function formatNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('en', {
    notation: number >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1
  }).format(number);
}

function formatExact(value) {
  return new Intl.NumberFormat('en').format(Number(value || 0));
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${formatExact(count)} ${count === 1 ? singular : pluralForm}`;
}

function getTypeLabel(type) {
  const labels = {
    tweet: 'X post',
    podcast: 'Podcast',
    blog: 'Blog post'
  };
  return labels[type] || 'Post';
}

function getSourceLinkLabel(type) {
  const labels = {
    tweet: 'Open on X',
    podcast: 'Open episode',
    blog: 'Read post'
  };
  return labels[type] || 'Open source';
}

function getHandle(item) {
  const source = String(item.source || '');
  return source.startsWith('@') ? source : '';
}

function domId(prefix, value) {
  return `${prefix}-${String(value || '').replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function isHighlight(item) {
  const highlightIds = new Set(state.signals?.highlights || []);
  return highlightIds.has(item.id) || Boolean(item.isHighlight);
}

/* ---------- Data selection ---------- */

function getSignalSearchBlob(item) {
  return [
    item.title,
    item.text,
    item.summary,
    item.author,
    item.source,
    item.category,
    item.reason,
    ...(item.matchedKeywords || [])
  ].join(' ').toLowerCase();
}

function getRepoSearchBlob(repo) {
  return [
    repo.name,
    repo.fullName,
    repo.description,
    repo.language,
    repo.category,
    repo.reason,
    ...(repo.topics || []),
    ...(repo.matchedKeywords || [])
  ].join(' ').toLowerCase();
}

function getVisibleSignals() {
  if (!state.signals) return [];

  const query = state.signalsQuery.trim().toLowerCase();
  const threshold = state.signals.highScoreThreshold || 65;

  return (state.signals.items || []).filter((item) => {
    if (state.signalsTheme && !state.signalsTheme.ids.has(item.id)) return false;
    if (state.signalsCategory === HIGHLIGHTS_CATEGORY && !isHighlight(item)) return false;

    if (
      state.signalsCategory !== ALL_CATEGORY &&
      state.signalsCategory !== HIGHLIGHTS_CATEGORY &&
      item.category !== state.signalsCategory
    ) {
      return false;
    }

    if (state.signalsHighScoreOnly && item.score < threshold) return false;
    if (query && !getSignalSearchBlob(item).includes(query)) return false;

    return true;
  });
}

function getVisibleRepos() {
  if (!state.repos) return [];

  const query = state.reposQuery.trim().toLowerCase();
  const threshold = state.repos.highScoreThreshold || 80;

  return (state.repos.items || []).filter((repo) => {
    if (state.reposCategory !== ALL_CATEGORY && repo.category !== state.reposCategory) return false;
    if (state.reposHighScoreOnly && repo.shiningScore < threshold) return false;
    if (query && !getRepoSearchBlob(repo).includes(query)) return false;
    return true;
  });
}

function getPracticalTools() {
  if (!state.repos) return [];
  const threshold = state.repos.highScoreThreshold || 80;

  return (state.repos.items || [])
    .filter((repo) => PRACTICAL_CATEGORIES.has(repo.category))
    .filter((repo) => repo.shiningScore >= Math.max(62, threshold - 8))
    .sort((a, b) => {
      if (b.shiningScore !== a.shiningScore) return b.shiningScore - a.shiningScore;
      if ((b.weeklyStars || 0) !== (a.weeklyStars || 0)) return (b.weeklyStars || 0) - (a.weeklyStars || 0);
      return b.stars - a.stars;
    })
    .slice(0, 9);
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item[key], (counts.get(item[key]) || 0) + 1);
  }
  return counts;
}

/* ---------- Shared pieces ---------- */

function renderTabs(container, categories, counts, activeCategory, onSelect) {
  // Empty categories are noise; keep "All" and whatever is currently selected.
  const visible = categories.filter((category) => (
    category === ALL_CATEGORY || category === activeCategory || (counts.get(category) ?? 0) > 0
  ));

  container.innerHTML = visible.map((category) => {
    const isActive = category === activeCategory;
    const count = counts.get(category) ?? 0;
    return `
      <button class="tab-button ${isActive ? 'active' : ''}" type="button" data-category="${escapeHTML(category)}" role="tab" aria-selected="${isActive}">${escapeHTML(category)}<span class="count">${formatExact(count)}</span></button>
    `;
  }).join('');

  container.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => onSelect(button.dataset.category));
  });
}

function scoreToggle(id, score, reason) {
  if (!reason) return `<span>Score ${escapeHTML(score)}</span>`;
  return `<button class="score-toggle" type="button" aria-expanded="false" aria-controls="${id}">Score ${escapeHTML(score)}</button>`;
}

function whyBlock(id, reason) {
  if (!reason) return '';
  return `<p class="why" id="${id}" hidden>${text(reason)}</p>`;
}

function emptyState(message, tag = 'p') {
  return `<${tag} class="empty-state">${escapeHTML(message)}</${tag}>`;
}

/* ---------- Masthead + lead ---------- */

function getLatestGeneratedAt() {
  const dates = [state.signals?.generatedAt, state.repos?.generatedAt]
    .map(toDate)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());

  return dates[0]?.toISOString() || null;
}

function renderStatus() {
  const latest = getLatestGeneratedAt();
  els.todayDate.textContent = latest ? formatLongDay(latest) : '';
  els.lastUpdated.textContent = latest ? `Updated ${formatClock(latest)} Beijing time` : 'Feeds unavailable';

  els.navSignalsCount.textContent = state.signals ? formatExact(state.signals.stats?.totalItems ?? state.signals.items?.length ?? 0) : '';
  els.navReposCount.textContent = state.repos ? formatExact(state.repos.stats?.totalRepos ?? state.repos.items?.length ?? 0) : '';
  els.navToolsCount.textContent = state.repos ? formatExact(getPracticalTools().length) : '';

  if (state.errors.length) {
    const details = state.errors.map((error) => `${error.source}: ${error.message} (${error.url})`).join('; ');
    els.feedNotice.textContent = `Some data didn't load. ${details}. Sections without data are empty until the next daily build.`;
    els.feedNotice.hidden = false;
  } else {
    els.feedNotice.hidden = true;
  }

  if (state.signals?.highScoreThreshold) els.signalsThreshold.textContent = state.signals.highScoreThreshold;
  if (state.repos?.highScoreThreshold) els.reposThreshold.textContent = state.repos.highScoreThreshold;
}

/* ---------- Summaries (rule-based, no model calls) ---------- */

// Cut a post down to its opening sentence or two. Sentence ends are ". ! ?"
// followed by a space, so version numbers like "5.2" stay intact.
function gist(value, { min = 90, max = 170 } = {}) {
  const clean = decodeEntities(value).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const sourceWasCut = /(?:\.\.\.|…)$/.test(clean);
  const body = clean.replace(/\s*(?:\.\.\.|…)$/, '');
  const sentences = body.split(/(?<=[.!?]["'”’)]*)\s+/);

  let out = '';
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) {
      // Too short to stand alone: borrow the start of the next sentence.
      if (out.length < min) out = cutAtWord(next, max);
      break;
    }
    out = next;
    if (out.length >= min) break;
  }

  if (!out) out = cutAtWord(body, max);

  const wasCut = out.length < body.length || sourceWasCut;
  return wasCut && !/[.!?"”’)]$/.test(out) ? `${out}…` : out;
}

function cutAtWord(value, max) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max / 2))).replace(/[\s,;:–—-]+$/, '');
}

function getSignalGist(item, options) {
  // Podcast and blog titles are already a summary of the piece.
  if (item.type !== 'tweet' && item.title) {
    const title = decodeEntities(item.title).trim();
    const max = options?.max ?? 170;
    return title.length <= max ? title : `${cutAtWord(title, max)}…`;
  }
  return gist(item.text || item.summary || item.title || '', options);
}

function themeTokens(value) {
  const tokens = [];
  const pattern = /[A-Za-z][A-Za-z0-9’'-]*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?|[.!?:;]/g;
  let sentenceStart = true;

  for (const match of value.replace(/https?:\/\/\S+/g, ' ').matchAll(pattern)) {
    if (/^[.!?:;]$/.test(match[0])) {
      sentenceStart = true;
      continue;
    }
    tokens.push({ word: match[0], sentenceStart });
    sentenceStart = false;
  }

  return tokens;
}

function containsPhrase(a, b) {
  return ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `);
}

// Find named things (products, companies, models) that several builders
// mentioned. Deliberately strict: no theme is better than a wrong one.
function detectThemes(items, limit = 2) {
  const authorNames = new Set(items.map((item) => String(item.author || '').toLowerCase()));
  const phrases = new Map();

  items.forEach((item, index) => {
    const tokens = themeTokens(decodeEntities(item.text || item.summary || ''));
    const seenInItem = new Set();

    for (let size = 1; size <= 3; size += 1) {
      for (let start = 0; start + size <= tokens.length; start += 1) {
        const gram = tokens.slice(start, start + size);
        const words = gram.map((token) => token.word.toLowerCase());

        if (THEME_STOPWORDS.has(words[0]) || THEME_STOPWORDS.has(words[size - 1])) continue;
        if (words.some((word) => word.length < 2) || /^[0-9.]+$/.test(words[0])) continue;

        const key = words.join(' ');
        if (authorNames.has(key)) continue;

        let entry = phrases.get(key);
        if (!entry) {
          entry = { key, size, items: new Set(), authors: new Set(), forms: new Map(), proper: false };
          phrases.set(key, entry);
        }

        // Capitalised somewhere other than the start of a sentence = a name.
        if (gram.some((token, i) => /^[A-Z0-9]/.test(token.word) && !(i === 0 && token.sentenceStart))) {
          entry.proper = true;
        }

        if (seenInItem.has(key)) continue;
        seenInItem.add(key);
        entry.items.add(index);
        entry.authors.add(item.author);
        const form = gram.map((token) => token.word).join(' ');
        entry.forms.set(form, (entry.forms.get(form) || 0) + 1);
      }
    }
  });

  const candidates = [...phrases.values()].filter((entry) => entry.proper && entry.items.size >= 3 && entry.authors.size >= 3);
  const themes = [];
  const covered = new Set();

  while (themes.length < limit) {
    const ranked = candidates
      .filter((candidate) => !themes.some((theme) => containsPhrase(theme.key, candidate.key)))
      .map((candidate) => {
        const fresh = [...candidate.items].filter((index) => !covered.has(index)).length;
        return { candidate, fresh, weight: fresh * (1 + 0.3 * (candidate.size - 1)) };
      })
      .filter((entry) => entry.fresh >= 3)
      .sort((a, b) => b.weight - a.weight);

    if (!ranked.length) break;
    const pick = ranked[0].candidate;
    themes.push(pick);
    pick.items.forEach((index) => covered.add(index));
  }

  return themes.map((theme) => ({
    label: [...theme.forms.entries()].sort((a, b) => b[1] - a[1])[0][0],
    posts: theme.items.size,
    builders: theme.authors.size
  }));
}

function getBuilderName(item) {
  return decodeEntities(item.author || item.source || 'Unknown');
}

function groupByBuilder(items) {
  const groups = new Map();
  for (const item of items) {
    const name = getBuilderName(item);
    if (!groups.has(name)) groups.set(name, { name, handle: getHandle(item), items: [] });
    groups.get(name).items.push(item);
  }
  return [...groups.values()];
}

function getTopRepo() {
  return [...(state.repos?.items || [])]
    .sort((a, b) => (Number(b.weeklyStars) || 0) - (Number(a.weeklyStars) || 0))[0];
}

function themeButton(theme) {
  return `<button class="theme-link" type="button" data-theme="${escapeHTML(theme.label)}"><mark>${escapeHTML(theme.label)}</mark></button>`;
}

/* ---------- Claude digest (optional; written by scripts/build-digest.js) ---------- */

// Only trust a digest written from the same feed the page is showing.
function getDigest() {
  const digest = state.digest;
  if (!digest || !state.signals) return null;
  if (digest.sourceGeneratedAt !== state.signals.generatedAt || !digest.brief) return null;
  return digest;
}

function modelLabel(id) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(String(id || ''));
  if (!match) return String(id || 'Claude');
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return `Claude ${family} ${match[2]}${match[3] ? `.${match[3]}` : ''}`;
}

function getDigestThemes() {
  const ids = new Set((state.signals?.items || []).map((item) => item.id));
  return (getDigest()?.themes || [])
    .map((theme) => ({ ...theme, postIds: (theme.postIds || []).filter((id) => ids.has(id)) }))
    .filter((theme) => theme.label && theme.postIds.length);
}

function getBuilderSummaries() {
  return new Map((getDigest()?.builders || []).map((builder) => [builder.name, builder.summary]));
}

function renderBrief() {
  const items = state.signals?.items || [];
  const topRepo = getTopRepo();
  const digest = getDigest();
  const sentences = [];

  if (digest) {
    sentences.push(text(digest.brief));
  } else if (items.length) {
    const builders = groupByBuilder(items).length;
    sentences.push(`${plural(items.length, 'post')} from ${plural(builders, 'builder')} in today’s feed.`);

    const themes = detectThemes(items);
    if (themes.length === 1) {
      const [theme] = themes;
      sentences.push(`${themeButton(theme)} came up most, in ${plural(theme.posts, 'post')} from ${plural(theme.builders, 'builder')}.`);
    } else if (themes.length > 1) {
      const [first, second] = themes;
      sentences.push(`${themeButton(first)} came up most (${plural(first.posts, 'post')} from ${plural(first.builders, 'builder')}), then ${themeButton(second)} (${plural(second.posts, 'post')}).`);
    }
  }

  if (topRepo && (Number(topRepo.weeklyStars) || 0) > 0) {
    sentences.push(`On GitHub, <a class="ink-link" href="${escapeHTML(topRepo.url || '#')}" target="_blank" rel="noreferrer">${text(topRepo.name)}</a> gained the most stars: +${formatExact(topRepo.weeklyStars)} since the last scan.`);
  }

  const note = digest
    ? `<p class="brief-note">Summaries on this page are written by ${escapeHTML(modelLabel(digest.model))} from today’s posts. Open a post to read it in full.</p>`
    : '';

  els.leadSignal.hidden = !sentences.length;
  els.leadSignal.innerHTML = sentences.length ? `<p class="brief">${sentences.join(' ')}</p>${note}` : '';
}

function renderThemeOverview(themes) {
  els.signalsOverview.innerHTML = `
    <table class="overview">
      <caption class="visually-hidden">Topics builders discussed today</caption>
      <thead>
        <tr>
          <th scope="col">Topic</th>
          <th scope="col" class="num">Posts</th>
          <th scope="col">What builders said</th>
        </tr>
      </thead>
      <tbody>
        ${themes.map((theme, index) => `
          <tr>
            <th scope="row"><button class="topic-link" type="button" data-theme-index="${index}">${text(theme.label)}</button></th>
            <td class="num">${formatExact(theme.postIds.length)}</td>
            <td class="overview-top"><span class="overview-summary">${text(theme.summary)}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderSignalsOverview() {
  const items = state.signals?.items || [];
  if (!items.length) {
    els.signalsOverview.innerHTML = '';
    return;
  }

  const themes = getDigestThemes();
  if (themes.length) {
    renderThemeOverview(themes);
    return;
  }

  const topics = new Map();
  for (const item of items) {
    if (!topics.has(item.category)) topics.set(item.category, { category: item.category, count: 0, top: item });
    topics.get(item.category).count += 1;
  }

  const rows = [...topics.values()].sort((a, b) => b.count - a.count || b.top.score - a.top.score);

  els.signalsOverview.innerHTML = `
    <table class="overview">
      <caption class="visually-hidden">Posts by topic, with the top-ranked post in each</caption>
      <thead>
        <tr>
          <th scope="col">Topic</th>
          <th scope="col" class="num">Posts</th>
          <th scope="col">Top post</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <th scope="row"><button class="topic-link" type="button" data-category="${escapeHTML(row.category)}">${text(row.category)}</button></th>
            <td class="num">${formatExact(row.count)}</td>
            <td class="overview-top">
              <strong>${text(getBuilderName(row.top))}</strong>
              <a href="${escapeHTML(row.top.url || '#')}" target="_blank" rel="noreferrer">${escapeHTML(getSignalGist(row.top, { min: 60, max: 120 }))}</a>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

/* ---------- Builder Signals ---------- */

function renderSignalTabs() {
  const items = state.signals?.items || [];
  const dataCategories = state.signals?.categories || [];
  const categories = unique([ALL_CATEGORY, HIGHLIGHTS_CATEGORY, ...dataCategories.filter((item) => item !== HIGHLIGHTS_CATEGORY)]);
  const counts = countBy(items, 'category');
  counts.set(ALL_CATEGORY, items.length);
  counts.set(HIGHLIGHTS_CATEGORY, items.filter(isHighlight).length);

  renderTabs(els.signalsCategoryTabs, categories, counts, state.signalsCategory, (category) => {
    state.signalsCategory = category;
    state.signalsTheme = null;
    render();
  });
}

function postEntry(item) {
  const whyId = domId('why-signal', item.id);
  const likes = Number(item.likes);

  return `
    <li class="post">
      <p class="post-gist">${markKeywords(getSignalGist(item), item.matchedKeywords)}</p>
      <p class="meta">
        <time datetime="${escapeHTML(item.publishedAt || '')}">${formatDate(item.publishedAt)}</time>
        <span>${text(item.category)}</span>
        ${item.type !== 'tweet' ? `<span>${getTypeLabel(item.type)}</span>` : ''}
        ${Number.isFinite(likes) && item.likes != null ? `<span>${plural(likes, 'like')}</span>` : ''}
        ${scoreToggle(whyId, item.score, item.reason)}
        ${item.url ? `<a class="ink-link" href="${escapeHTML(item.url)}" target="_blank" rel="noreferrer">${getSourceLinkLabel(item.type)}</a>` : ''}
      </p>
      ${whyBlock(whyId, item.reason)}
    </li>
  `;
}

function builderGroup(group, summaries) {
  const summary = summaries.get(group.name);

  return `
    <li class="builder ${summary ? 'has-summary' : ''}">
      <div class="builder-who">
        <strong>${escapeHTML(group.name)}</strong>
        ${group.handle ? `<span>${escapeHTML(group.handle)}</span>` : ''}
        ${group.items.length > 1 ? `<span class="builder-count">${plural(group.items.length, 'post')}</span>` : ''}
      </div>
      <div class="builder-body">
        ${summary ? `<p class="builder-summary">${text(summary)}</p>` : ''}
        <ol class="builder-posts">
          ${group.items.map(postEntry).join('')}
        </ol>
      </div>
    </li>
  `;
}

function renderSignals(items) {
  if (!state.signals) {
    els.signalsGrid.innerHTML = emptyState(getErrorMessage('Builder Signals', 'Builder Signals data is not available yet.'), 'li');
    els.signalsResultsMeta.textContent = '';
    return;
  }

  const total = state.signals.items?.length || 0;
  const groups = groupByBuilder(items);

  if (state.signalsTheme) {
    els.signalsResultsMeta.innerHTML = `${plural(items.length, 'post')} about <strong>${escapeHTML(state.signalsTheme.label)}</strong>, from ${plural(groups.length, 'builder')} <button class="clear-filter" type="button">Show all posts</button>`;
  } else {
    els.signalsResultsMeta.textContent = items.length === total
      ? `${plural(total, 'post')} from ${plural(groups.length, 'builder')}, grouped by builder`
      : `${formatExact(items.length)} of ${plural(total, 'post')}, from ${plural(groups.length, 'builder')}`;
  }

  if (!items.length) {
    els.signalsGrid.innerHTML = emptyState('No posts match these filters. Try another topic or clear the search.', 'li');
    return;
  }

  const summaries = getBuilderSummaries();
  els.signalsGrid.innerHTML = groups.map((group) => builderGroup(group, summaries)).join('');
}

/* ---------- GitHub Weekly Stars ---------- */

function renderRepoTabs() {
  const items = state.repos?.items || [];
  const categories = unique([ALL_CATEGORY, ...(state.repos?.categories || [])]);
  const counts = countBy(items, 'category');
  counts.set(ALL_CATEGORY, items.length);

  renderTabs(els.reposCategoryTabs, categories, counts, state.reposCategory, (category) => {
    state.reposCategory = category;
    state.reposLimit = REPO_PAGE_SIZE;
    render();
  });
}

function getRepoRanks() {
  return new Map((state.repos?.items || []).map((repo, index) => [repo.fullName, index + 1]));
}

function getMaxWeeklyStars() {
  return Math.max(1, ...(state.repos?.items || []).map((repo) => Number(repo.weeklyStars) || 0));
}

function repoOwner(repo) {
  const fullName = String(repo.fullName || '');
  return fullName.includes('/') ? fullName.split('/')[0] : '';
}

function repoDelta(repo, maxWeekly) {
  const weekly = Number(repo.weeklyStars) || 0;

  if (weekly <= 0 && repo.newCandidate) {
    return `
      <div class="repo-delta">
        <p><strong>New</strong><small>first seen in this scan</small></p>
      </div>
    `;
  }

  const width = Math.max(0, Math.min(100, (weekly / maxWeekly) * 100));
  return `
    <div class="repo-delta">
      <p><strong>${weekly > 0 ? '+' : ''}${formatExact(weekly)}</strong><small>new stars</small></p>
      <span class="bar" aria-hidden="true"><span style="width: ${width.toFixed(1)}%"></span></span>
    </div>
  `;
}

function repoRow(repo, rank, maxWeekly) {
  const owner = repoOwner(repo);
  const whyId = domId('why-repo', repo.fullName);

  return `
    <li class="repo">
      <span class="repo-rank">${rank}</span>
      <div class="repo-main">
        <h3>
          <a href="${escapeHTML(repo.url || '#')}" target="_blank" rel="noreferrer">${text(repo.name)}</a>
          ${owner ? `<span class="repo-owner">by ${text(owner)}</span>` : ''}
        </h3>
        <p class="repo-desc">${markKeywords(repo.description || 'No description provided.', repo.matchedKeywords)}</p>
        <p class="meta">
          <span>${text(repo.category)}</span>
          ${repo.language ? `<span>${text(repo.language)}</span>` : ''}
          <span>${formatNumber(repo.stars)} stars</span>
          <span>${formatNumber(repo.forks)} forks</span>
          ${scoreToggle(whyId, repo.shiningScore, repo.reason)}
        </p>
        ${whyBlock(whyId, repo.reason)}
      </div>
      ${repoDelta(repo, maxWeekly)}
    </li>
  `;
}

function renderRepos(items) {
  if (!state.repos) {
    els.reposGrid.innerHTML = emptyState(getErrorMessage('GitHub Weekly Stars', 'GitHub Weekly Stars data is not available yet.'), 'li');
    els.reposResultsMeta.textContent = '';
    els.reposMoreRow.hidden = true;
    return;
  }

  const total = state.repos.items?.length || 0;
  const biggest = [...countBy(state.repos.items || [], 'category').entries()].sort((a, b) => b[1] - a[1])[0];
  els.reposResultsMeta.textContent = items.length === total
    ? `${plural(total, 'repo')}${biggest ? `. ${biggest[0]} is the biggest group, with ${formatExact(biggest[1])}.` : ''}`
    : `${formatExact(items.length)} of ${plural(total, 'repo')}`;

  if (!items.length) {
    els.reposGrid.innerHTML = emptyState('No repos match these filters. Try another category or clear the search.', 'li');
    els.reposMoreRow.hidden = true;
    return;
  }

  const ranks = getRepoRanks();
  const maxWeekly = getMaxWeeklyStars();
  const shown = items.slice(0, state.reposLimit);

  els.reposGrid.innerHTML = shown
    .map((repo) => repoRow(repo, ranks.get(repo.fullName) ?? '', maxWeekly))
    .join('');

  const remaining = items.length - shown.length;
  els.reposMoreRow.hidden = remaining <= 0;
  if (remaining > 0) {
    const next = Math.min(REPO_PAGE_SIZE, remaining);
    els.reposShowing.textContent = `Showing ${formatExact(shown.length)} of ${formatExact(items.length)}`;
    els.reposMoreButton.textContent = `Show ${formatExact(next)} more`;
  }
}

/* ---------- Practical Tools ---------- */

function toolPick(repo) {
  const owner = repoOwner(repo);
  const weekly = Number(repo.weeklyStars) || 0;

  return `
    <article class="pick">
      <h3><a href="${escapeHTML(repo.url || '#')}" target="_blank" rel="noreferrer">${text(repo.name)}</a></h3>
      ${owner ? `<span class="repo-owner">by ${text(owner)}</span>` : ''}
      <p class="pick-desc">${text(repo.description || 'No description provided.')}</p>
      <p class="meta">
        <span>${text(repo.category)}</span>
        ${repo.language ? `<span>${text(repo.language)}</span>` : ''}
        <span>${formatNumber(repo.stars)} stars</span>
        ${weekly > 0 ? `<span>+${formatNumber(weekly)} new</span>` : ''}
      </p>
    </article>
  `;
}

function renderPracticalTools() {
  if (!state.repos) {
    els.toolsGrid.innerHTML = emptyState(getErrorMessage('GitHub Weekly Stars', 'GitHub Weekly Stars data is not available yet.'));
    return;
  }

  const tools = getPracticalTools();
  if (!tools.length) {
    els.toolsGrid.innerHTML = emptyState('No repos cleared the score threshold for this list today.');
    return;
  }

  els.toolsGrid.innerHTML = tools.map(toolPick).join('');
}

/* ---------- Render loop ---------- */

function render() {
  const visibleSignals = getVisibleSignals();
  const visibleRepos = getVisibleRepos();

  renderStatus();
  renderBrief();
  renderSignalsOverview();
  renderSignalTabs();
  renderRepoTabs();
  renderSignals(visibleSignals);
  renderRepos(visibleRepos);
  renderPracticalTools();
}

async function fetchJSON(source, path) {
  const url = dataUrl(path);
  url.searchParams.set('t', String(Date.now()));

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    const error = new Error(`${source} returned HTTP ${response.status}`);
    error.source = source;
    error.url = url.pathname;
    throw error;
  }

  try {
    return await response.json();
  } catch (err) {
    const error = new Error(`${source} returned invalid JSON`);
    error.source = source;
    error.url = url.pathname;
    error.cause = err;
    throw error;
  }
}

function recordFetchResult(result, stateKey, source, path) {
  if (result.status === 'fulfilled') {
    state[stateKey] = result.value;
    return;
  }

  const reason = result.reason || new Error('Unknown fetch failure');
  state.errors.push({
    source,
    message: reason.message || `${source} failed to load`,
    url: reason.url || dataUrl(path).pathname
  });
}

async function init() {
  const [signalsResult, reposResult, historyResult, digestResult] = await Promise.allSettled([
    fetchJSON('Builder Signals', DATA_PATHS.signals),
    fetchJSON('GitHub Weekly Stars', DATA_PATHS.repos),
    fetchJSON('GitHub Stars History', DATA_PATHS.history),
    fetchJSON('Claude digest', DATA_PATHS.digest)
  ]);

  recordFetchResult(signalsResult, 'signals', 'Builder Signals', DATA_PATHS.signals);
  recordFetchResult(reposResult, 'repos', 'GitHub Weekly Stars', DATA_PATHS.repos);
  recordFetchResult(historyResult, 'history', 'GitHub Stars History', DATA_PATHS.history);

  // The digest is optional: without it the page uses its rule-based summary,
  // so a missing file is not reported as a feed issue.
  if (digestResult.status === 'fulfilled') state.digest = digestResult.value;

  render();
}

els.signalsSearchInput.addEventListener('input', (event) => {
  state.signalsQuery = event.target.value;
  render();
});

els.signalsHighScoreOnly.addEventListener('change', (event) => {
  state.signalsHighScoreOnly = event.target.checked;
  render();
});

els.reposSearchInput.addEventListener('input', (event) => {
  state.reposQuery = event.target.value;
  state.reposLimit = REPO_PAGE_SIZE;
  render();
});

els.reposHighScoreOnly.addEventListener('change', (event) => {
  state.reposHighScoreOnly = event.target.checked;
  state.reposLimit = REPO_PAGE_SIZE;
  render();
});

els.reposMoreButton.addEventListener('click', () => {
  state.reposLimit += REPO_PAGE_SIZE;
  render();
});

function showSignals({ category = ALL_CATEGORY, query = '', theme = null, scroll = true }) {
  state.signalsCategory = category;
  state.signalsQuery = query;
  state.signalsTheme = theme;
  els.signalsSearchInput.value = query;
  render();
  if (scroll) els.signalsResultsMeta.scrollIntoView({ block: 'start' });
}

document.addEventListener('click', (event) => {
  // A theme in the rule-based brief searches for it.
  const theme = event.target.closest('.theme-link');
  if (theme) {
    showSignals({ query: theme.dataset.theme });
    return;
  }

  // A topic in the overview filters the list: Claude's topics by post id,
  // rule-based topics by category.
  const topic = event.target.closest('.topic-link');
  if (topic) {
    if (topic.dataset.themeIndex != null) {
      const picked = getDigestThemes()[Number(topic.dataset.themeIndex)];
      if (picked) showSignals({ theme: { label: picked.label, ids: new Set(picked.postIds) } });
    } else {
      showSignals({ category: topic.dataset.category });
    }
    return;
  }

  if (event.target.closest('.clear-filter')) {
    showSignals({ scroll: false });
    return;
  }

  // "Score N" opens the plain-language reason behind that score.
  const toggle = event.target.closest('.score-toggle');
  if (!toggle) return;

  const panel = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!panel) return;

  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  panel.hidden = expanded;
});

init();
