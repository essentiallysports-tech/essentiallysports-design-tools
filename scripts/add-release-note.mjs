#!/usr/bin/env node
// Adds a draft release note to tours/updates.json from the commits since the
// last note, for a person to edit. The note feeds the What's new panel and the
// automatic What's new tour (see project-docs/release-tours.md).
//
//   node scripts/add-release-note.mjs                    draft from git log
//   node scripts/add-release-note.mjs --title "Gallery filters"
//   node scripts/add-release-note.mjs --since 1a2b3c4    pick the starting commit
//   node scripts/add-release-note.mjs --publish          no draft flag
//   node scripts/add-release-note.mjs --dry-run          print, don't write
//   node scripts/add-release-note.mjs --file other.json --cwd path/to/repo
//
// Draft notes ("draft": true) are ignored by the app until the flag is removed.
// Commit subjects shaped "Area: change" are grouped by area into one item each.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'tours', 'updates.json');
const MAX_COMMITS = 40;

// Where an area's change lives, so the tour can go there (a person adds the
// `target` selector; without one the tour shows a centred card).
const AREA_PAGES = [
  [/video ads?/i, 'video-ads.html'],
  [/generate|trends?|ai studio/i, 'generate.html'],
  [/reels?|caption/i, 'reels.html'],
  [/gallery/i, 'gallery.html'],
  [/dashboard/i, 'dashboard.html'],
  [/design request/i, 'design-request.html'],
  [/feedback/i, 'tool-feedback.html'],
  [/editor|social|youtube|newsletter|template|listicle|canvas|export|home/i, 'index.html'],
];

// Subjects that are housekeeping, not news.
const NOISE = /^(merge\b|revert\b|wip\b|bump\b|chore\b|tests?\b|docs?\b|ci\b|fixup!|squash!)|cache[- ]?bust|edit log|ai-edit-log/i;

export function parseArgs(argv) {
  const args = { title: '', since: '', date: '', file: DEFAULT_FILE, cwd: ROOT, dryRun: false, publish: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => argv[++i] ?? '';
    if (flag === '--title') args.title = value();
    else if (flag === '--since') args.since = value();
    else if (flag === '--date') args.date = value();
    else if (flag === '--file') args.file = path.resolve(value());
    else if (flag === '--cwd') args.cwd = path.resolve(value());
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--publish') args.publish = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  return args;
}

export function readManifest(file) {
  if (!fs.existsSync(file)) return { version: 1, entries: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(data)) return { version: 1, entries: data };
  return { ...data, entries: Array.isArray(data.entries) ? data.entries : [] };
}

/** The commit the newest note was written at (entries are newest first). */
export function lastNoteCommit(manifest) {
  return manifest.entries.find(entry => entry && entry.commit)?.commit || '';
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** [{ sha, subject }] after `since` (exclusive), oldest first, no merges. */
export function commitsSince(cwd, since) {
  const range = since ? [`${since}..HEAD`] : [`-n${MAX_COMMITS}`];
  const out = git(cwd, ['log', '--no-merges', '--reverse', '--format=%h%x09%s', ...range]);
  return out ? out.split('\n').map(line => {
    const [sha, ...rest] = line.split('\t');
    return { sha, subject: rest.join('\t').trim() };
  }).slice(-MAX_COMMITS) : [];
}

function sentence(text) {
  const clean = String(text).trim().replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '');
  return clean ? `${clean.charAt(0).toUpperCase()}${clean.slice(1)}.` : '';
}

function pageFor(area) {
  return AREA_PAGES.find(([pattern]) => pattern.test(area))?.[1] || '';
}

/**
 * Turns commit subjects into note items. "Area: change, change" subjects are
 * grouped by area; the rest become one item each, titled by their subject.
 */
export function itemsFromCommits(commits) {
  const groups = new Map();
  const loose = [];
  commits.forEach(({ subject }) => {
    if (!subject || NOISE.test(subject)) return;
    const match = subject.match(/^([A-Z][\w &/+.-]{1,40}):\s+(.+)$/);
    if (match) {
      const area = match[1].trim();
      if (!groups.has(area)) groups.set(area, []);
      groups.get(area).push(match[2]);
    } else {
      loose.push(subject);
    }
  });
  const items = [];
  groups.forEach((changes, area) => {
    const item = { title: area, text: changes.map(sentence).join(' ') };
    const page = pageFor(area);
    if (page) item.page = page;
    items.push(item);
  });
  loose.forEach(subject => items.push({ title: sentence(subject).replace(/\.$/, ''), text: '' }));
  return items;
}

export function slug(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'update';
}

export function buildEntry({ commits, title, date, head, existingIds = [], publish = false }) {
  const items = itemsFromCommits(commits);
  const day = date || new Date().toISOString().slice(0, 10);
  const name = title || items[0]?.title || 'FrameUp update';
  let id = `${day}-${slug(name)}`;
  for (let n = 2; existingIds.includes(id); n += 1) id = `${day}-${slug(name)}-${n}`;
  const entry = { id, date: day, title: name };
  if (!publish) entry.draft = true;
  if (head) entry.commit = head;
  entry.items = items.length ? items : [{ title: name, text: 'Describe the change in one line.' }];
  return entry;
}

/** Newest first: the new entry goes to the top. */
export function addEntry(manifest, entry) {
  return { ...manifest, entries: [entry, ...manifest.entries] };
}

export function writeManifest(file, manifest) {
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 15).map(line => line.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const manifest = readManifest(args.file);
  const since = args.since || lastNoteCommit(manifest);
  const commits = commitsSince(args.cwd, since);
  const head = git(args.cwd, ['rev-parse', '--short', 'HEAD']);
  const entry = buildEntry({
    commits,
    title: args.title,
    date: args.date,
    head,
    existingIds: manifest.entries.map(item => item.id),
    publish: args.publish,
  });
  if (args.dryRun) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  writeManifest(args.file, addEntry(manifest, entry));
  console.log(`Added "${entry.title}" (${entry.id}) from ${commits.length} commit${commits.length === 1 ? '' : 's'}${since ? ` since ${since}` : ''}.`);
  console.log(`Edit ${path.relative(process.cwd(), args.file) || args.file}: tighten the copy, add "target" selectors${entry.draft ? ', then delete "draft": true' : ''}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`add-release-note: ${error.message}`);
    process.exitCode = 1;
  }
}
