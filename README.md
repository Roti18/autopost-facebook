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

4. Create a `config.json` file in the root directory with your Facebook login credentials:
   ```json
   {
     "email": "your_email_or_phone",
     "password": "your_password"
   }
   ```
   > **Note:** `config.json` is listed in `.gitignore` and will never be committed to version control. Keep it safe and do not share it.

## How to Run

1. Start the bot runner:
   ```bash
   npm start
   ```

2. Login behavior:
   * **Session still valid:** The bot detects the saved session and starts posting immediately — no action needed.
   * **Session expired / first run:** The bot automatically fills in the email and password from `config.json` into the Facebook login form. You only need to **solve the CAPTCHA or security checkpoint manually** in the browser window. Once you complete it and land on the home feed, the bot resumes posting automatically.
   * On subsequent runs after a successful login, the bot reuses the saved session and skips the login step entirely.
