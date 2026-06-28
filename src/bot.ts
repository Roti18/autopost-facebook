import { chromium, Locator, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { config, resolveSpintax, getSeedGroups } from './config';
import {
  initDb,
  getActiveGroups,
  updateGroupLastPosted,
  addPostHistory,
  getGroupCount,
  seedGroups,
  closeDb
} from './db';

/**
 * Load login credentials from config.json
 */
function loadLoginCredentials(): { email: string; password: string } | null {
  const configPath = path.resolve(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    console.warn('config.json not found. Auto-fill login will be skipped.');
    return null;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const creds = JSON.parse(raw);
    if (creds.email && creds.password) {
      return { email: creds.email, password: creds.password };
    }
    console.warn('config.json is missing email or password fields.');
    return null;
  } catch (err) {
    console.error('Failed to parse config.json:', err);
    return null;
  }
}


/**
 * Utility function to sleep for a specified duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Instantly inserts post content into the editor (similar to paste).
 */
async function pasteContent(page: Page, locator: Locator, text: string) {
  await locator.focus();
  await page.keyboard.insertText(text);
}

/**
 * Main automated posting flow.
 */
async function main() {
  console.log('Initializing database...');
  initDb();

  // Seed/Sync groups from configuration
  console.log('Syncing groups from configuration...');
  const seedList = getSeedGroups();
  seedGroups(seedList);

  // Load active groups from database
  const activeGroups = getActiveGroups();
  if (activeGroups.length === 0) {
    console.log('No active groups found in database. Exiting.');
    closeDb();
    return;
  }

  console.log(`Found ${activeGroups.length} active groups to process.`);

  // Create user data directory if it doesn't exist
  if (!fs.existsSync(config.userDataDir)) {
    fs.mkdirSync(config.userDataDir, { recursive: true });
    console.log(`Created user data directory at: ${config.userDataDir}`);
  }

  console.log('Launching browser with persistent context...');
  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: config.headless,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: null, // Letting the browser manage the viewport size
    args: [
      '--disable-notifications',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
      '--no-sandbox',
      '--disable-infobars'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  // Apply stealth script to bypass automation detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  try {
    // 1. Session Check & Bootstrap Login
    console.log('Navigating to Facebook Home...');
    await page.goto('https://facebook.com/', { waitUntil: 'domcontentloaded' });

    console.log('Checking login status...');
    const loginSelectors = [
      'input#email',
      'input[name="email"]',
      'button[name="login"]',
      'a[data-testid="open-registration-form-button"]'
    ];

    const loggedInSelectors = [
      '[role="navigation"]',
      'input[placeholder*="Cari"]',
      'input[placeholder*="Search"]',
      '[aria-label="Facebook"]',
      'a[href*="/me/"]',
      'div[aria-label="Akun"]'
    ];

    let isLogged = false;
    let isLoginScreen = false;

    // Polling to identify current page state
    for (let attempts = 0; attempts < 16; attempts++) {
      // Check for logged in elements
      for (const sel of loggedInSelectors) {
        if (await page.locator(sel).first().isVisible()) {
          isLogged = true;
          break;
        }
      }
      if (isLogged) break;

      // Check for login fields
      for (const sel of loginSelectors) {
        if (await page.locator(sel).first().isVisible()) {
          isLoginScreen = true;
          break;
        }
      }
      if (isLoginScreen) break;

      await sleep(500);
    }

    if (isLoginScreen && !isLogged) {
      console.log('\n===============================================================');
      console.log('WARNING: Facebook session not found or expired.');
      console.log('Attempting auto-fill from config.json...');
      console.log('===============================================================\n');

      // --- Auto-fill email & password from config.json ---
      const creds = loadLoginCredentials();
      if (creds) {
        try {
          // Fill email
          const emailInput = page.locator('input#email, input[name="email"]').first();
          if (await emailInput.isVisible()) {
            await emailInput.fill('');
            await emailInput.type(creds.email, { delay: 80 });
            console.log('Auto-filled email from config.json.');
          }

          // Fill password
          const passInput = page.locator('input#pass, input[name="pass"], input[type="password"]').first();
          if (await passInput.isVisible()) {
            await passInput.fill('');
            await passInput.type(creds.password, { delay: 80 });
            console.log('Auto-filled password from config.json.');
          }

          console.log('\n>>> Credentials filled. Please solve the CAPTCHA / checkpoint manually in the browser, then login will proceed automatically. <<<\n');
        } catch (fillErr) {
          console.error('Error during auto-fill:', fillErr);
          console.log('Please log in manually in the browser window.');
        }
      } else {
        console.log('No credentials in config.json. Please log in manually in the browser window.');
      }

      let loggedIn = false;
      const maxRetries = 180; // 15 minutes wait limit to give plenty of time for captcha
      let retries = 0;

      while (!loggedIn && retries < maxRetries) {
        await sleep(5000);
        retries++;
        
        // Check if logged in selectors became visible
        let feedVisible = false;
        for (const sel of loggedInSelectors) {
          if (await page.locator(sel).first().isVisible()) {
            feedVisible = true;
            break;
          }
        }

        // We ONLY mark loggedIn as true if the feed/home indicators are fully visible!
        // This gives the user all the time they need to solve captchas/checkpoints.
        if (feedVisible) {
          loggedIn = true;
        } else {
          const currentUrl = page.url();
          if (currentUrl.includes('checkpoint') || currentUrl.includes('captcha')) {
            if (retries % 3 === 0) {
              console.log('Bot status: Waiting for security checkpoint/CAPTCHA to be solved manually...');
            }
          } else {
            if (retries % 3 === 0) {
              console.log('Bot status: Waiting for manual login completion...');
            }
          }
        }
      }

      if (!loggedIn) {
        throw new Error('Login wait timeout exceeded. Exiting bot.');
      }
      console.log('Login detected successfully! Re-routing to start queue...');
      await sleep(3000);
    } else if (isLogged) {
      console.log('Facebook session loaded successfully! (Logged in state verified)');
    } else {
      console.log('Could not identify login state clearly. Proceeding with existing session context...');
    }

    // 2. Loop Through Active Groups
    for (let i = 0; i < activeGroups.length; i++) {
      const group = activeGroups[i];
      console.log(`\n---------------------------------------------------`);
      console.log(`[${i + 1}/${activeGroups.length}] Processing Group: "${group.group_name}"`);
      console.log(`URL: ${group.group_url}`);

      // Check last posted schedule to see if it should wait (Scheduler logic)
      if (group.last_posted_at) {
        const lastPosted = new Date(group.last_posted_at).getTime();
        const now = Date.now();
        const diffMinutes = (now - lastPosted) / (1000 * 60);

        if (diffMinutes < config.postIntervalMinutes) {
          console.log(`Group was posted to ${diffMinutes.toFixed(2)} minutes ago. Required interval is ${config.postIntervalMinutes} minutes. Skipping.`);
          continue;
        }
      }

      try {
        console.log('Navigating to group URL...');
        await page.goto(group.group_url, { waitUntil: 'domcontentloaded' });
        await sleep(5000); // Allow FB DOM to hydrate

        // Locate "Tulis sesuatu..." (Write something...) button
        console.log('Locating "Write something" button...');
        const writeBtnSelectors = [
          'div.xi81zsa.x1lkfr7t.xkjl1po.x1mzt3pk.xh8yej3.x13faqbe',
          'text="Tulis sesuatu..."',
          'text="Write something..."',
          'text="Mulai diskusi..."',
          'text="Create a public post..."',
          'span:has-text("Tulis sesuatu...")',
          'span:has-text("Write something...")'
        ];

        let writeBtn: Locator | null = null;
        for (const selector of writeBtnSelectors) {
          const loc = page.locator(selector).first();
          if (await loc.isVisible()) {
            writeBtn = loc;
            break;
          }
        }

        if (!writeBtn) {
          throw new Error('Could not find the "Tulis sesuatu..." button on group page. Are you a member or is the page format different?');
        }

        console.log('Opening post creation dialog...');
        await writeBtn.click();
        
        // Wait for dialog box to appear
        const dialog = page.locator('div[role="dialog"]').first();
        await dialog.waitFor({ state: 'visible', timeout: 15000 });

        // Locate text input box
        console.log('Locating text editor...');
        const textBox = dialog.locator('div[contenteditable="true"][role="textbox"]').first();
        await textBox.waitFor({ state: 'visible', timeout: 10000 });

        // Resolve Spintax for post content
        const postText = resolveSpintax(config.postContent);
        console.log(`Resolved post caption:\n"${postText}"`);

        // Paste post content instantly
        console.log('Pasting post caption...');
        await pasteContent(page, textBox, postText);
        await sleep(1500);

        // Upload image if configured
        if (config.imagePath) {
          if (fs.existsSync(config.imagePath)) {
            console.log(`Uploading media file: ${config.imagePath}`);
            const fileInput = dialog.locator('input[type="file"]').first();
            const mediaBtn = dialog.locator('div[aria-label="Foto/video"][role="button"], div[aria-label="Photo/video"][role="button"]').first();

            if (await fileInput.count() > 0) {
              await fileInput.setInputFiles(config.imagePath);
            } else if (await mediaBtn.isVisible()) {
              try {
                const [fileChooser] = await Promise.all([
                  page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null),
                  mediaBtn.click()
                ]);
                if (fileChooser) {
                  await fileChooser.setFiles(config.imagePath);
                } else {
                  await dialog.locator('input[type="file"]').first().setInputFiles(config.imagePath);
                }
              } catch (fileErr) {
                console.log('File chooser click timeout or error. Attempting direct setInputFiles...');
                await page.setInputFiles('input[type="file"]', config.imagePath);
              }
            } else {
              // Try global selector fallback
              await page.setInputFiles('input[type="file"]', config.imagePath);
            }

            console.log('Waiting 5s for media upload preview...');
            await sleep(5000);
          } else {
            console.warn(`Warning: Configuration specified imagePath "${config.imagePath}" but the file does not exist.`);
          }
        }

        // Locate "Posting" (Submit) button
        console.log('Locating Posting submit button...');
        const postBtnSelectors = [
          'div[aria-label="Posting"][role="button"]',
          'div[aria-label="Post"][role="button"]',
          'span:has-text("Posting")',
          'span:has-text("Post")'
        ];

        let postBtn: Locator | null = null;
        for (const selector of postBtnSelectors) {
          const loc = dialog.locator(selector).first();
          if (await loc.isVisible() && await loc.isEnabled()) {
            postBtn = loc;
            break;
          }
        }

        if (!postBtn) {
          throw new Error('Could not find the "Posting" button in composer dialog.');
        }

        console.log('Submitting post...');
        await postBtn.click();

        // Wait until post modal closes (indicator of success)
        console.log('Waiting for modal to close (confirming upload completion)...');
        await dialog.waitFor({ state: 'hidden', timeout: 35000 });
        console.log('Success! Modal closed.');

        // Update DB
        const nowIso = new Date().toISOString();
        updateGroupLastPosted(group.id, nowIso);
        addPostHistory(group.id, postText, 'success');
        console.log(`Updated database record for Group: "${group.group_name}"`);

      } catch (err: any) {
        console.error(`FAILED to post to group "${group.group_name}":`, err.message);
        addPostHistory(group.id, resolveSpintax(config.postContent), 'failed', err.message);
      }

      // Add Random Delay between groups to avoid spam checks (except for the last one)
      if (i < activeGroups.length - 1) {
        const min = config.minDelaySeconds;
        const max = config.maxDelaySeconds;
        const delaySeconds = Math.floor(Math.random() * (max - min + 1)) + min;
        console.log(`Cooldown delay: Sleeping for ${delaySeconds} seconds to simulate human timing...`);
        await sleep(delaySeconds * 1000);
      }
    }

  } finally {
    console.log('Closing browser...');
    await context.close();
    console.log('Closing database...');
    closeDb();
    console.log('Process completed.');
  }
}

// Run bot
main().catch((err) => {
  console.error('Fatal error in bot main runner:', err);
});
