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
    // Strip BOM (U+FEFF) if present — common from Windows Notepad
    const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    const creds = JSON.parse(cleaned);
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
 * Instantly inserts post content into the Lexical editor.
 * Facebook uses Lexical which handles newlines via Enter key (creating <p> tags).
 */
async function pasteContent(page: Page, locator: Locator, text: string) {
  await locator.focus();
  await sleep(500);

  // Click the inner <p> to place cursor properly inside Lexical editor
  const innerP = locator.locator('p').first();
  if (await innerP.isVisible().catch(() => false)) {
    await innerP.click({ position: { x: 5, y: 5 }, force: true });
  } else {
    await locator.click({ force: true });
  }
  await sleep(500);

  // Clear any existing content first
  await page.keyboard.press('Control+a');
  await sleep(100);
  await page.keyboard.press('Delete');
  await sleep(300);

  // Split text into lines and type each line + Enter for newline
  // Lexical needs real Enter keypresses to create proper <p> paragraph breaks
  const lines = text.split('\n');
  console.log(`Typing ${lines.length} lines into Lexical editor...`);

  for (let i = 0; i < lines.length; i++) {
    // Trim the line to avoid extra whitespace issues
    const line = lines[i].trimEnd();
    if (line.length > 0) {
      await page.keyboard.type(line, { delay: 10 });
    }

    // Press Enter after each line except the last one
    if (i < lines.length - 1) {
      // If the original line was empty, we just press Enter (blank paragraph)
      if (line.length === 0) {
        await page.keyboard.press('Enter');
        await sleep(50);
      } else {
        await page.keyboard.press('Enter');
        await sleep(80);
      }
    }
  }

  console.log('Text typed successfully!');
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
    // Narrow logged-in selectors — exclude [role="navigation"] because FB login page footer also has nav
    const loggedInSelectors = [
      'input[placeholder*="Cari"]',
      'input[placeholder*="Search"]',
      'a[href*="/me/"]',
      'div[aria-label="Akun"]',
      'div[aria-label="Account"]',
      '[data-pagelet="left_nav"]'
    ];

    // Broad login-page selectors — covers: classic email/password form, profile-picker (Continue as ...),
    // and footer links like "Log in" / "Masuk"
    const loginSelectors = [
      'input#email',
      'input[name="email"]',
      'input[type="password"]',
      'button[name="login"]',
      'button:has-text("Continue")',
      'button:has-text("Lanjutkan")',
      'button:has-text("Log in")',
      'button:has-text("Masuk")',
      'div[role="button"]:has-text("Continue")',
      'div[role="button"]:has-text("Lanjutkan")',
      'div[aria-label^="Continue "]',
      'div[aria-label^="Lanjutkan sebagai "]',
      'a:has-text("Log in")',
      'a:has-text("Sign in")',
      'a:has-text("Masuk")',
      'a[data-testid="open-registration-form-button"]'
    ];

    const loggedInUrlPatterns = ['/me/', '?sk=', '/photos/', '/friends/', 'facebook.com/?', 'facebook.com/home'];

    let isLogged = false;
    let isLoginScreen = false;

    // Polling to identify current page state
    for (let attempts = 0; attempts < 30; attempts++) {
      // Check for logged in elements
      for (const sel of loggedInSelectors) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) {
          isLogged = true;
          break;
        }
      }
      if (isLogged) break;

      // Check for login fields
      for (const sel of loginSelectors) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) {
          isLoginScreen = true;
          break;
        }
      }
      if (isLoginScreen) break;

      // Check URL as fallback
      const currentUrl = page.url();
      if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
        isLoginScreen = true;
        break;
      }

      await sleep(500);
    }

    // Final fallback: URL heuristic — if still on plain facebook.com/ and not logged in, it's a login page
    if (!isLogged && !isLoginScreen) {
      const finalUrl = page.url();
      // Check if URL looks like a plain facebook landing (no feed paths)
      const looksLikeLoginUrl = (
        finalUrl.includes('login.php') ||
        finalUrl.includes('checkpoint') ||
        finalUrl === 'https://www.facebook.com/' ||
        finalUrl === 'https://facebook.com/' ||
        finalUrl.endsWith('facebook.com') ||
        finalUrl.endsWith('facebook.com/')
      );
      const looksLikeLoggedIn = loggedInUrlPatterns.some(p => finalUrl.includes(p));
      if (looksLikeLoginUrl && !looksLikeLoggedIn) {
        isLoginScreen = true;
        console.log('Detected login page from URL heuristic (plain facebook.com/).');
      }
    }

    // ----- LOGIN HANDLER -----
    // Reusable: waits for login completion, fills creds, waits up to 15 min
    async function handleLoginScreen() {
      console.log('\n===============================================================');
      console.log('WARNING: Facebook session not found or expired.');
      console.log('Attempting auto-fill from config.json...');
      console.log('===============================================================\n');

      const creds = loadLoginCredentials();
      if (creds) {
        try {
          // Step 1: Fill email
          const emailInput = page.locator('input#email, input[name="email"]').first();
          if (await emailInput.isVisible().catch(() => false)) {
            await emailInput.fill('');
            await emailInput.type(creds.email, { delay: 80 });
            console.log('Auto-filled email from config.json.');
          }

          // Step 2: Click "Continue" / "Log in" button (FB new flow)
          // Handles both <button> and <div role="button"> (profile picker)
          const continueBtn = page.locator(
            'button:has-text("Continue"), ' +
            'button:has-text("Lanjutkan"), ' +
            'button:has-text("Log in"), ' +
            'button:has-text("Masuk"), ' +
            'button[name="login"], ' +
            'div[aria-label^="Continue "], ' +
            'div[aria-label^="Lanjutkan sebagai "]'
          ).first();
          if (await continueBtn.isVisible().catch(() => false)) {
            await continueBtn.click();
            console.log('Clicked Continue/Login button.');
            await sleep(3000); // Wait for password form to appear or login to complete
          }

          // Step 3: Fill password (if visible after Continue step)
          const passInput = page.locator('input#pass, input[name="pass"], input[type="password"]').first();
          if (await passInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await passInput.fill('');
            await passInput.type(creds.password, { delay: 80 });
            console.log('Auto-filled password from config.json.');

            // Step 4: Click login button after filling password
            const loginBtn = page.locator(
              'button:has-text("Log in"), ' +
              'button:has-text("Masuk"), ' +
              'button[name="login"]'
            ).first();
            if (await loginBtn.isVisible().catch(() => false)) {
              await loginBtn.click();
              console.log('Clicked final login button.');
            }
          }

          console.log('\n>>> Credentials filled. Please solve the CAPTCHA / checkpoint manually in the browser if any. <<<\n');
        } catch (fillErr) {
          console.error('Error during auto-fill:', fillErr);
          console.log('Please log in manually in the browser window.');
        }
      } else {
        console.log('No credentials in config.json. Please log in manually in the browser window.');
      }

      let loggedIn = false;
      const maxRetries = 180;
      let retries = 0;

      while (!loggedIn && retries < maxRetries) {
        await sleep(5000);
        retries++;

        let feedVisible = false;
        for (const sel of loggedInSelectors) {
          if (await page.locator(sel).first().isVisible().catch(() => false)) {
            feedVisible = true;
            break;
          }
        }

        if (feedVisible) {
          loggedIn = true;
        } else {
          const currentUrl = page.url();
          if (currentUrl.includes('checkpoint') || currentUrl.includes('captcha')) {
            if (retries % 3 === 0) console.log('Bot status: Waiting for security checkpoint/CAPTCHA to be solved manually...');
          } else {
            if (retries % 3 === 0) console.log('Bot status: Waiting for manual login completion...');
          }
        }
      }

      if (!loggedIn) throw new Error('Login wait timeout exceeded. Exiting bot.');
      console.log('Login detected successfully! Re-routing to start queue...');
      await sleep(3000);
    }

    if (isLogged) {
      console.log('Facebook session loaded successfully! (Logged in state verified)');
    } else {
      // If we didn't flag login screen yet, do final fallback checks
      if (!isLoginScreen) {
        const passVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
        if (passVisible) {
          console.log('Password field detected — treating as login screen.');
          isLoginScreen = true;
        }
      }

      if (isLoginScreen) {
        await handleLoginScreen();
      } else {
        console.log('Could not identify login state clearly. Proceeding with existing session context...');
      }
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

        // Locate "Tulis sesuatu..." (Write something...) button with retry logic
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
        const MAX_BUTTON_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_BUTTON_RETRIES; attempt++) {
          console.log(`  Attempt ${attempt}/${MAX_BUTTON_RETRIES}: checking for composer button...`);

          for (const selector of writeBtnSelectors) {
            const loc = page.locator(selector).first();
            if (await loc.isVisible().catch(() => false)) {
              writeBtn = loc;
              break;
            }
          }

          if (writeBtn) {
            console.log('  Composer button found!');
            break;
          }

          if (attempt < MAX_BUTTON_RETRIES) {
            const waitMs = 4000;
            console.log(`  Button not visible yet. Waiting ${waitMs / 1000}s before retry...`);
            await sleep(waitMs);
          }
        }

        if (!writeBtn) {
          throw new Error('Could not find the "Tulis sesuatu..." button on group page. Are you a member or is the page format different?');
        }

        console.log('Opening post composer...');
        await writeBtn.click();

        // Give time for inline composer to render
        await sleep(3000);

        // Facebook uses inline composer with a specific placeholder.
        // CRITICAL: Must target the GROUP composer, not a comment reply box!
        // Comment editors also have contenteditable="true" role="textbox"
        // but they have different aria-placeholder values.
        console.log('Locating group post composer (targeting aria-placeholder="Buat postingan publik...")...');
        const textBox = page.locator(
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="Buat postingan"], ' +
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="Write a public"], ' +
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="public"], ' +
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="postingan"]'
        ).first();
        await textBox.waitFor({ state: 'visible', timeout: 15000 });
        console.log('Post composer located successfully (NOT a comment editor).');

        // Resolve Spintax for post content
        const postText = resolveSpintax(config.postContent);
        console.log(`Resolved post caption:\n"${postText}"`);

        // ----- UPLOAD IMAGE FIRST (before text) -----
        // Upload image first so any composer re-render from the upload
        // doesn't wipe out the text we already typed.
        if (config.imagePath) {
          if (fs.existsSync(config.imagePath)) {
            console.log(`Uploading media file: ${config.imagePath}`);
            const mediaBtn = page.locator('div[aria-label="Foto/video"][role="button"], div[aria-label="Photo/video"][role="button"], div[aria-label="Add photo/video"][role="button"]').first();

            try {
              const [fileChooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
                mediaBtn.click()
              ]);
              if (fileChooser) {
                await fileChooser.setFiles(config.imagePath);
              } else {
                await page.setInputFiles('input[type="file"]', config.imagePath);
              }
            } catch (fileErr) {
              console.log('Media button click failed. Trying direct file input...');
              await page.setInputFiles('input[type="file"]', config.imagePath);
            }

            console.log('Waiting 5s for media upload preview to stabilize...');
            await sleep(5000);
          } else {
            console.warn(`Warning: Configuration specified imagePath "${config.imagePath}" but the file does not exist.`);
          }
        }

        // ----- NOW INSERT TEXT (after image upload is stable) -----
        // Re-locate the text editor after image upload (may have been re-rendered)
        console.log('Re-locating post composer after image upload...');
        const textBoxAfterUpload = page.locator(
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="Buat postingan"], ' +
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="Write a public"], ' +
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="public"], ' +
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="postingan"]'
        ).first();
        await textBoxAfterUpload.waitFor({ state: 'visible', timeout: 10000 });

        // Paste post content
        console.log('Pasting post caption...');
        await pasteContent(page, textBoxAfterUpload, postText);
        await sleep(1500);

        // Locate "Posting" (Submit) button on the page (not inside a dialog)
        console.log('Locating Posting submit button...');
        const postBtnSelectors = [
          'div[aria-label="Posting"][role="button"]',
          'div[aria-label="Post"][role="button"]',
          'span:has-text("Posting")',
          'span:has-text("Post")'
        ];

        let postBtn: Locator | null = null;
        for (const selector of postBtnSelectors) {
          const loc = page.locator(selector).first();
          if (await loc.isVisible() && await loc.isEnabled()) {
            postBtn = loc;
            break;
          }
        }

        if (!postBtn) {
          throw new Error('Could not find the "Posting" button on the page.');
        }

        console.log('Submitting post...');
        await postBtn.click();

        // Verify post was actually submitted — wait for the composer to go away
        // AND the "Tulis sesuatu..." button to reappear
        console.log('Waiting for post to complete...');
        await sleep(3000);

        let postSuccess = false;
        for (let retry = 0; retry < 20; retry++) {
          // Check if text editor is gone (composer closed = post submitted)
          const editorVisible = await textBoxAfterUpload.isVisible().catch(() => false);
          if (!editorVisible) {
            postSuccess = true;
            break;
          }

          // Check if "Tulis sesuatu..." reappeared (indicates composer reset)
          const writeReappeared = await page.locator('span:has-text("Tulis sesuatu...")').first().isVisible().catch(() => false);
          if (writeReappeared) {
            postSuccess = true;
            break;
          }

          await sleep(2000);
        }

        if (!postSuccess) {
          // One more check — maybe the post went through but composer didn't close
          // Check if the editor content is now empty (was submitted)
          const editorText = await textBoxAfterUpload.evaluate(el => el.textContent?.trim() || '').catch(() => '');
          if (editorText === '') {
            postSuccess = true;
          } else {
            // Try clicking Posting button again just in case
            console.log('Post may not have gone through. Trying to click Posting again...');
            const postBtnAgain = page.locator('div[aria-label="Posting"][role="button"], div[aria-label="Post"][role="button"]').first();
            if (await postBtnAgain.isVisible().catch(() => false)) {
              await postBtnAgain.click();
              await sleep(5000);
              const stillVisible = await postBtnAgain.isVisible().catch(() => false);
              if (!stillVisible) {
                postSuccess = true;
              }
            }
          }
        }

        if (!postSuccess) {
          throw new Error('Post submission failed — composer did not close after clicking Posting.');
        }

        console.log('Post submitted successfully! Composer confirmed closed.');

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
