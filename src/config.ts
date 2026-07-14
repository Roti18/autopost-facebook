import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { BotConfig } from './types';

// Load .env file
dotenv.config();

/**
 * Spintax Resolver: Rotates text using {option1|option2|option3} format.
 * Supports nested structures by resolving from the innermost brackets outwards.
 */
export function resolveSpintax(text: string): string {
  const spintaxPattern = /\{([^{}]+)\}/g;
  let matches = text.match(spintaxPattern);
  
  while (matches && matches.length > 0) {
    for (const match of matches) {
      const choices = match.slice(1, -1).split('|');
      const selected = choices[Math.floor(Math.random() * choices.length)];
      // Replace only the first occurrence of this exact match pattern to avoid bug if multiple exist
      text = text.replace(match, selected);
    }
    matches = text.match(spintaxPattern);
  }
  
  return text;
}

// Default values
const DEFAULT_POST_CONTENT = '{Halo|Hi|Permisi|Selamat pagi/siang} teman-teman! {Semoga hari Anda menyenangkan.|Semoga lancar usahanya.|Salam sukses!}';

const getPostContent = (): string => {
  const templatePath = path.resolve(process.env.POST_TEMPLATE_PATH || 'post_template.txt');
  if (fs.existsSync(templatePath)) {
    try {
      return fs.readFileSync(templatePath, 'utf8');
    } catch (err) {
      console.error('Error reading post template file:', err);
    }
  }
  return DEFAULT_POST_CONTENT;
};

export const config: BotConfig = {
  userDataDir: path.resolve(process.env.FB_USER_DATA_DIR || 'user_data'),
  headless: process.env.HEADLESS === 'true',
  minDelaySeconds: parseInt(process.env.MIN_DELAY_SECONDS || '60', 10),
  maxDelaySeconds: parseInt(process.env.MAX_DELAY_SECONDS || '180', 10),
  postContent: getPostContent(),
  imagePaths: process.env.IMAGE_PATH
    ? process.env.IMAGE_PATH.split(',').map(p => path.resolve(p.trim())).filter((p, i, a) => a.indexOf(p) === i)
    : [],
  postIntervalMinutes: parseInt(process.env.POST_INTERVAL_MINUTES || '60', 10),
};

// Default seed groups: parsed from groups.json if exists, else environment variable, else fallback
export const getSeedGroups = (): { name: string; url: string }[] => {
  const jsonPath = path.resolve(process.cwd(), 'groups.json');
  
  if (fs.existsSync(jsonPath)) {
    try {
      const fileContent = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(fileContent);
      if (Array.isArray(parsed)) {
        return parsed.map((item: any) => ({
          name: item.name || 'Unnamed Group',
          url: item.url.trim()
        }));
      }
    } catch (jsonError) {
      console.error('Error reading/parsing groups.json, falling back to other configs...', jsonError);
    }
  }

  const defaultSeed = [
    {
      name: 'Jual Beli Parfum Mykonos Dan Parfum Ghoib Lokal dan Timteng',
      url: 'https://facebook.com/groups/485809131249248/',
    }
  ];

  if (!process.env.DEFAULT_GROUPS) {
    return defaultSeed;
  }

  try {
    return process.env.DEFAULT_GROUPS.split(',').map(item => {
      const [url, name] = item.split('|');
      return {
        url: url.trim(),
        name: name ? name.trim() : 'Unnamed Group',
      };
    });
  } catch (error) {
    console.error('Error parsing DEFAULT_GROUPS environment variable, using fallback seed groups.', error);
    return defaultSeed;
  }
};
