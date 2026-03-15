export type DeliverableType = "pr" | "report" | "commit_only" | "review";

/** スレッド内の 1 ターン分の会話記録 */
export interface ConversationTurn {
  /** ユーザーが送ったプロンプト */
  prompt: string;
  /** エージェントが返した結果サマリー */
  summary: string;
  /** 作成された PR の URL（あれば） */
  prUrl?: string;
}

export interface ExecuteOptions {
  jobId: string;
  userId: string;
  prompt: string;
  repository: string; // "owner/repo"
  branch: string;
  githubToken: string;
  mcpConfig?: object;
  instructions?: string;
  /** 新ブランチを作成するか、既存ブランチで続行するかの明示的指定。未指定時は new として扱う */
  branchMode?: "new" | "existing";
  /** スレッド内の過去ターン履歴（時系列昇順）。空配列または undefined の場合は省略 */
  conversationHistory?: ConversationTurn[];
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
