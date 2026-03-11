export interface CopilotEvent {
  type: string;
  // New Copilot CLI v1.x format fields
  data?: {
    content?: string;
    toolName?: string;
    arguments?: unknown;
    success?: boolean;
    result?: { content?: string; detailedContent?: string };
    toolRequests?: Array<{ name: string; arguments: unknown; toolCallId: string; type?: string }>;
    [key: string]: unknown;
  };
  exitCode?: number;
  // Legacy format fields
  content?: string;
  tool?: string;
  input?: unknown;
  command?: string;
  stdout?: string;
  stderr?: string;
  path?: string;
  message?: string;
  summary?: string;
  prUrl?: string;
}
