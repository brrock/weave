import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

/** Uses CHROME_PATH if set, otherwise Playwright's Chromium (`bunx playwright install chromium`). */
export const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

/** The running dev server (`bun dev`). */
export const APP_URL = process.env.URL ?? "http://localhost:5173";

/** Screenshot folder (git-ignored). */
export const shots = new URL("./shots/", import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
