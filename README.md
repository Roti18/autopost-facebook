# Facebook Auto Poster Bot

A Node.js and TypeScript automation script designed to post content to multiple Facebook groups using Playwright and SQLite. It utilizes persistent browser sessions to reuse cookies and localStorage, minimizing checkpoint risks. It also supports Spintax rotation to vary post text, and interval checking to prevent double-posting to the same group too quickly.

## Requirements

* Node.js (version 18 or above recommended)
* npm (Node Package Manager)

## Installation

1. Install project dependencies:
   ```bash
   npm install
   ```

2. Download the Chromium browser binaries required for Playwright:
   ```bash
   npx playwright install chromium
   ```

## Configuration

1. Create a `.env` file in the root directory based on the `.env.example` file:
   ```bash
   cp .env.example .env
   ```

2. Configure the following variables in `.env`:
   * `HEADLESS`: Set to `false` to display the browser window (required for the first-time manual login) or `true` for background execution.
   * `FB_USER_DATA_DIR`: Directory path to store browser session profiles.
   * `MIN_DELAY_SECONDS` and `MAX_DELAY_SECONDS`: Random delay constraints between group postings to mimic human behavior.
   * `POST_INTERVAL_MINUTES`: Minimum duration to wait before posting to the same group again.
   * `POST_CONTENT`: The text template supporting Spintax (e.g., `{Hello|Hi} friends`).
   * `IMAGE_PATH`: Path to an image file (optional, leave blank for text-only posts).

3. Add your target Facebook group links to the `groups.json` file in the root folder:
   ```json
   [
     {
       "name": "Group Name 1",
       "url": "https://www.facebook.com/groups/ID_1/"
     },
     {
       "name": "Group Name 2",
       "url": "https://www.facebook.com/groups/ID_2/"
     }
   ]
   ```

## How to Run

1. Start the bot runner:
   ```bash
   npm start
   ```

2. Perform the initial manual login:
   * During the first execution, a Chromium browser window will open.
   * Log in manually to your Facebook account and complete any security checkpoints or CAPTCHAs if prompted.
   * Once you are on the Facebook home feed, the bot will automatically detect the active session, save it to the session directory, and begin posting to your list of groups.
   * On subsequent runs, the bot will reuse this session and bypass the login step entirely.
