export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL as string || '',
  basePath: import.meta.env.BASE_URL,
  /** The harness package the entry points run from. */
  harnessPackage: (import.meta.env.VITE_HARNESS_PACKAGE as string) || 'agent-harness',
  /** The agent selected on first visit, before the user picks one. */
  defaultAgentId: (import.meta.env.VITE_DEFAULT_AGENT_ID as string) || 'moco-assistant',
} as const;
