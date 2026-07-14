export interface Group {
  id: number;
  group_name: string;
  group_url: string;
  status: 'active' | 'inactive';
  last_posted_at: string | null;
}

export interface PostHistory {
  id: number;
  group_id: number;
  post_content: string;
  status: 'success' | 'failed';
  error_message: string | null;
  created_at: string;
}

export interface BotConfig {
  userDataDir: string;
  headless: boolean;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  postContent: string;
  imagePaths: string[];
  postIntervalMinutes: number;
}
