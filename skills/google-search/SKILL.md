---
name: google-search
description: Perform web searches using Google via Puppeteer with a persistent Chrome instance. Use this skill when the user needs to search the web, look up information, find documentation, or research any topic online.
---

# Google Search

Google search via Puppeteer. Reuses a persistent Chrome instance across searches.

## Setup

```bash
cd $(dirname SKILL.md)/../../ && npm install
```

## Usage

Run the script from the skill directory:

```bash
node google-search.js <query> [-n <num>]
```

- `-n <num>` — number of results (default: 10, max: 100)

## How it works

1. Connects to existing Chrome on debug port 9222, or launches a new visible instance
2. Navigates to Google, waits for results (if CAPTCHA appears, Chrome is visible — solve it manually)
3. Extracts titles, URLs, snippets from the DOM
4. Prints numbered results to stdout
5. Keeps Chrome alive for instant reuse on next search
