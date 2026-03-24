export interface AiProviderRecord {
  id: string;
  name: string;
  kind: string;
  baseUrl?: string;
  defaultModel: string;
  apiKeyRef: string;
  hasApiKey?: boolean;
  apiKeyStorage?: string;
  apiKeyStorageKind?: string;
  availableModels?: string[];
  enabled: boolean;
}
