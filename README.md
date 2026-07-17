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
   * `POST_TEMPLATE_PATH`: Path to the text template file (default: `post_template.txt`).
   * `IMAGE_PATH`: Path to image files (multiple paths can be comma-separated, optional, leave blank for text-only posts).

3. Create the `post_template.txt` file in the root directory based on the `post_template.example.txt` file, and write your post message inside:
   ```bash
   cp post_template.example.txt post_template.txt
   ```
   > **Note:** The template supports Spintax formatting (e.g., `{Hello|Hi} friends!`) to randomly rotate variations of words or phrases, and is Git-ignored to prevent leaking your custom text.

4. Create the `groups.json` file in the root directory based on the `groups.example.json` file, and add your target Facebook group links:
   ```bash
   cp groups.example.json groups.json
   ```
   * Configure it like this:
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

5. Create a `config.json` file in the root directory with your Facebook login credentials:
   ```json
   {
     "email": "your_email_or_phone",
     "password": "your_password"
   }
   ```
   > **Note:** `groups.json`, `post_template.txt`, and `config.json` are listed in `.gitignore` and will never be committed to version control. Keep them safe and do not share them.

## How to Run

1. Start the bot runner:
   ```bash
   npm start
   ```

2. Login behavior:
   * **Session still valid:** The bot detects the saved session and starts posting immediately — no action needed.
   * **Session expired / first run:** The bot automatically fills in the email and password from `config.json` into the Facebook login form. You only need to **solve the CAPTCHA or security checkpoint manually** in the browser window. Once you complete it and land on the home feed, the bot resumes posting automatically.
   * On subsequent runs after a successful login, the bot reuses the saved session and skips the login step entirely.
