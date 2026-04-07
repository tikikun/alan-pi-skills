---
name: get-webpage
description: Fetch and read the content of any webpage URL using Puppeteer with a persistent Chrome instance. Use this skill when you need to visit a URL, read an article, extract page content, follow up on a search result, or retrieve documentation from a specific page.
---

# Get Webpage

Fetches and extracts readable text content from any URL via Puppeteer. Reuses the same persistent Chrome instance as the `google-search` skill — so if Chrome is already running from a search, this connects instantly.

## Setup

```bash
cd $(dirname SKILL.md)/../../ && npm install
```

## Usage

Run the script from the skill directory:

```bash
node get-webpage.js <url> [--text-only] [--max-length <chars>]
```

### Options
- `--text-only` — Strip all markup and return clean plain text (default: on)
- `--no-text-only` — Return raw HTML instead
- `--max-length <n>` — Truncate output to n characters (default: 20000)
- `--wait <seconds>` — Extra time to wait for JS-rendered content before scraping (e.g. `--wait 60` for heavy SPA pages)

### Examples
```bash
# Fetch an article as plain text
node get-webpage.js https://example.com/article

# Fetch with more content
node get-webpage.js https://docs.python.org/3/library/asyncio.html --max-length 50000

# Wait 60s for a JS-heavy page to fully render before scraping
node get-webpage.js https://huggingface.co/papers --wait 60

# Auto-prefixes https:// if missing
node get-webpage.js example.com
```

## How it works

1. Connects to existing Chrome on debug port 9222 (shared with `google-search`), or launches a new visible instance
2. Navigates to the URL and waits for DOM content to load
3. Waits an extra 1.5s for JS-rendered content to settle
4. Removes noise (scripts, styles, nav, footer, ads, etc.)
5. Prioritises `<main>`, `<article>`, or `[role=main]` for focused extraction
6. Falls back to full `<body>` text if no main content area found
7. Prints clean text to stdout, truncated to `--max-length`
8. Keeps Chrome alive for instant reuse on next call

## Combine with google-search

A typical research workflow:
1. Use `google-search` to find relevant URLs
2. Use `get-webpage` to read the full content of promising results
