export interface ModelOption {
  name: string;
  displayName: string | null;
}

export async function fetchAvailableModels(): Promise<ModelOption[]> {
  try {
    const res = await fetch(`${process.env["API_BASE_URL"]}/api/models`);
    const data = (await res.json()) as { models: ModelOption[] };
    return data.models;
  } catch {
    return []; // フォールバック: Auto のみ表示
  }
}
