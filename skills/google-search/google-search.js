#!/usr/bin/env node

/**
 * Google Search via Puppeteer — reuses a persistent Chrome debug instance.
 *
 * Usage: google-search.js <query> [-n <num>]
 */

import puppeteer from "puppeteer";
import { homedir } from "os";
import { join } from "path";
import { existsSync, rmSync, readlinkSync } from "fs";
import { execSync } from "child_process";

const DEBUG_PORT  = 9222;
const PROFILE_DIR = join(homedir(), "Library", "Application Support", "pi-chrome-profile");

// ─── Args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
	console.log("Usage: google-search.js <query> [-n <num>]");
	process.exit(0);
}
const nIdx = argv.indexOf("-n");
const num  = nIdx !== -1 ? Math.min(parseInt(argv[nIdx + 1], 10) || 10, 100) : 10;
const query = argv.filter((a, i) => a !== "-n" && (nIdx === -1 || i !== nIdx + 1)).join(" ").trim();
if (!query) { console.error("✗ No query"); process.exit(1); }

const params = new URLSearchParams({ q: query, hl: "en", num: String(num) });
const url = `https://www.google.com/search?${params}`;

// ─── Clear stale singleton locks ─────────────────────────────────────────────
// Checks the PID in SingletonLock — if the process is gone, removes all three
// singleton files so Chrome can start fresh.
function clearStaleLocks(profileDir) {
	const lockPath = join(profileDir, "SingletonLock");
	if (!existsSync(lockPath)) return; // no lock at all, nothing to do

	// Read the PID from the symlink target (format: "hostname-PID")
	try {
		const target = readlinkSync(lockPath);
		const pid    = target.split("-").pop();
		try {
			execSync(`kill -0 ${pid}`, { stdio: "ignore" });
			console.error(`⚠️  Chrome (PID ${pid}) is still running on the pi-chrome-profile — reusing it`);
			return; // process alive — don't touch anything
		} catch { /* process gone — safe to clean up */ }
	} catch { /* can't read symlink — treat as stale */ }

	// Process is dead — remove all three singleton files
	for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
		const p = join(profileDir, name);
		try { rmSync(p, { force: true }); console.error(`🧹 Removed stale ${name}`); }
		catch { /* ignore */ }
	}
}

// ─── Launch helper (retries once with a wiped profile on crash) ─────────────
async function launchChrome() {
	const opts = {
		headless: false,   // bundled Chrome for Testing — separate from system Chrome
		args: [
			`--remote-debugging-port=${DEBUG_PORT}`,
			`--user-data-dir=${PROFILE_DIR}`,
			"--no-first-run",
			"--no-default-browser-check",
		],
	};
	try {
		return await puppeteer.launch(opts);
	} catch (err) {
		// Profile may be corrupt/incompatible — wipe it and try once more
		console.error("⚠️  Chrome failed to launch, wiping profile and retrying…");
		rmSync(PROFILE_DIR, { recursive: true, force: true });
		return await puppeteer.launch(opts);
	}
}

// ─── Connect or launch Chrome ────────────────────────────────────────────────
let browser;
try {
	browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}` });
	console.error("♻️  Reusing existing Chrome");
} catch {
	clearStaleLocks(PROFILE_DIR);
	console.error("🌐 Launching Chrome…");
	browser = await launchChrome();
}

const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });

// ─── Wait for results (handles CAPTCHA — Chrome is visible) ─────────────────
// Poll until we see real search results (not a CAPTCHA page)
console.error("⏳ Waiting for search results…");
await page.waitForFunction(
	() => {
		const loc = window.location.href;
		// Still on CAPTCHA?
		if (loc.includes("/sorry/") || document.querySelector("#captcha-form")) return false;
		// Have results?
		return document.querySelectorAll("#search a h3").length > 0;
	},
	{ timeout: 300_000, polling: 1000 }  // 5 min to solve CAPTCHA if needed
);

// ─── Extract results ────────────────────────────────────────────────────────
const results = await page.evaluate(() => {
	const items = [];
	// Each result: an <a> containing an <h3> inside #search
	document.querySelectorAll("#search a").forEach(a => {
		const h3 = a.querySelector("h3");
		if (!h3) return;
		const href = a.href;
		if (!href || href.includes("google.com/search") || href.includes("accounts.google")) return;

		// Find snippet — usually in a sibling/parent's nearby div
		let snippet = "";
		// Walk up to the result container and look for snippet text
		let container = a.closest("[data-hveid]") || a.closest(".g") || a.parentElement?.parentElement?.parentElement;
		if (container) {
			// Common snippet selectors
			const snipEl = container.querySelector("[data-sncf]")
				|| container.querySelector(".VwiC3b")
				|| container.querySelector("[style*='-webkit-line-clamp']");
			if (snipEl) snippet = snipEl.innerText.trim();
		}

		items.push({ title: h3.innerText.trim(), url: href, snippet });
	});
	return items;
});

await page.close();
// Don't close browser — keep it alive for reuse

if (results.length === 0) {
	console.error("✗ No results found");
	process.exit(1);
}

for (let i = 0; i < Math.min(results.length, num); i++) {
	const r = results[i];
	console.log(`${i + 1}. ${r.title}`);
	console.log(`   ${r.url}`);
	if (r.snippet) console.log(`   ${r.snippet}`);
	console.log();
}

console.error(`✓ ${Math.min(results.length, num)} results for: ${query}`);

// Disconnect without killing browser
browser.disconnect();
