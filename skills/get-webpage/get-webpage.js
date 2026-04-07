#!/usr/bin/env node

/**
 * Get Webpage via Puppeteer — reuses a persistent Chrome debug instance.
 *
 * Usage: get-webpage.js <url> [--text-only] [--max-length <chars>]
 */

import puppeteer from "puppeteer";
import { homedir } from "os";
import { join } from "path";

const DEBUG_PORT  = 9222;
const PROFILE_DIR = join(homedir(), "Library", "Application Support", "pi-chrome-profile");

// ─── Args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
	console.log("Usage: get-webpage.js <url> [--text-only] [--max-length <chars>]");
	console.log("  --text-only          Strip all markup, output plain text (default: true)");
	console.log("  --max-length <n>     Truncate output to n characters (default: 20000)");
	process.exit(0);
}

const textOnly   = !argv.includes("--no-text-only");
const maxIdx     = argv.indexOf("--max-length");
const maxLength  = maxIdx !== -1 ? parseInt(argv[maxIdx + 1], 10) || 20000 : 20000;
const waitIdx    = argv.indexOf("--wait");
const waitMs     = waitIdx !== -1 ? (parseFloat(argv[waitIdx + 1]) || 0) * 1000 : 0;
const url        = argv.filter((a, i) =>
	a !== "--text-only" &&
	a !== "--no-text-only" &&
	a !== "--max-length" &&
	a !== "--wait" &&
	(maxIdx === -1 || i !== maxIdx + 1) &&
	(waitIdx === -1 || i !== waitIdx + 1)
).join(" ").trim();

if (!url) { console.error("✗ No URL provided"); process.exit(1); }

// Basic URL validation / auto-prefix
const resolvedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

// ─── Connect or launch Chrome ───────────────────────────────────────────────
let browser;
try {
	browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}` });
	console.error("♻️  Reusing existing Chrome");
} catch {
	console.error("🌐 Launching Chrome…");
	browser = await puppeteer.launch({
		headless: false,
		args: [
			`--remote-debugging-port=${DEBUG_PORT}`,
			`--user-data-dir=${PROFILE_DIR}`,
			"--no-first-run",
			"--no-default-browser-check",
		],
	});
}

const page = await browser.newPage();

// Set a realistic user-agent to avoid bot detection
await page.setUserAgent(
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
);

console.error(`⏳ Fetching ${resolvedUrl} …`);

try {
	await page.goto(resolvedUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
} catch (err) {
	console.error(`✗ Failed to load page: ${err.message}`);
	await page.close();
	browser.disconnect();
	process.exit(1);
}

// Wait for JS-rendered content (default 1.5s, extended by --wait)
const totalWait = Math.max(1500, waitMs);
if (waitMs > 0) console.error(`⏱️  Waiting ${waitMs/1000}s for JS to render…`);
await new Promise(r => setTimeout(r, totalWait));

// ─── Extract content ─────────────────────────────────────────────────────────
const result = await page.evaluate((textOnly) => {
	const pageTitle = document.title || "";
	const pageUrl   = window.location.href;

	if (!textOnly) {
		return { title: pageTitle, url: pageUrl, content: document.documentElement.outerHTML };
	}

	// Remove noise elements
	["script", "style", "noscript", "nav", "footer", "header", "aside",
	 "iframe", "svg", "img", "[aria-hidden='true']", ".cookie-banner",
	 "#cookie-notice", ".ad", ".advertisement"].forEach(sel => {
		document.querySelectorAll(sel).forEach(el => el.remove());
	});

	// Try to find main content area first
	const mainSelectors = ["main", "article", "[role='main']", ".content",
	                       "#content", ".post-content", ".article-body",
	                       ".entry-content", "#main-content", ".markdown-body"];
	let contentEl = null;
	for (const sel of mainSelectors) {
		contentEl = document.querySelector(sel);
		if (contentEl) break;
	}
	// Fallback to body
	if (!contentEl) contentEl = document.body;

	// Extract text — preserve some structure with newlines
	const text = (contentEl?.innerText || document.body.innerText || "")
		.replace(/\n{3,}/g, "\n\n")   // collapse excessive blank lines
		.replace(/[ \t]{2,}/g, " ")   // collapse horizontal whitespace
		.trim();

	return { title: pageTitle, url: pageUrl, content: text };
}, textOnly);

await page.close();
browser.disconnect();

// ─── Output ───────────────────────────────────────────────────────────────────
const header = `URL: ${result.url}\nTitle: ${result.title}\n${"─".repeat(60)}\n`;
let content = result.content;

if (content.length > maxLength) {
	content = content.slice(0, maxLength) + `\n\n… [truncated — ${content.length - maxLength} more chars]`;
}

console.log(header + content);
console.error(`✓ Fetched: ${result.title || result.url}`);
