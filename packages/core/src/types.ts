export type DeliverableType = "pr" | "report" | "commit_only" | "review";

export interface ExecuteOptions {
  jobId: string;
  userId: string;
  prompt: string;
  repository: string; // "owner/repo"
  branch: string;
  githubToken: string;
  mcpConfig?: object;
  instructions?: string;
  previousContext?: string; // 前回ジョブのサマリー（軽量セッション）
  deliverableType?: DeliverableType;
}

export interface CopilotEvent {
  type: string;
  data?: {
    content?: string;
    toolName?: string;
    arguments?: unknown;
    success?: boolean;
    result?: { content?: string; detailedContent?: string };
    toolRequests?: Array<{
      name: string;
      arguments: unknown;
      toolCallId: string;
      type?: string;
    }>;
    [key: string]: unknown;
  };
  exitCode?: number;
  content?: string;
  tool?: string;
  input?: unknown;
  command?: string;
  stdout?: string;
  stderr?: string;
  path?: string;
  diff?: string;
  message?: string;
  summary?: string;
  prUrl?: string;
}
