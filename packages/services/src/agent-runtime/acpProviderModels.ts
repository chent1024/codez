import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAppConfigDir } from "#src/paths.js";

export interface SavedAcpModel {
  id: string;
  name: string;
  description?: string;
  thoughtLevels?: Array<{ value: string; name: string }>;
}

interface SavedAcpModelsEntry {
  fingerprint: string;
  models: SavedAcpModel[];
  availableModels?: SavedAcpModel[];
}

type SavedAcpModelsDocument = Record<string, SavedAcpModelsEntry>;

function path(): string {
  return join(getAppConfigDir(), "agent-models.json");
}

async function readDocument(): Promise<SavedAcpModelsDocument> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path(), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("ACP model selection document is invalid");
  const result: SavedAcpModelsDocument = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`ACP model selection is invalid: ${id}`);
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.fingerprint !== "string" ||
      !Array.isArray(entry.models) ||
      (entry.availableModels !== undefined && !Array.isArray(entry.availableModels)) ||
      !entry.models.every(
        (model) =>
          model &&
          typeof model === "object" &&
          typeof model.id === "string" &&
          model.id.length > 0 &&
          typeof model.name === "string" &&
          (model.description === undefined || typeof model.description === "string") &&
          (model.thoughtLevels === undefined ||
            (Array.isArray(model.thoughtLevels) &&
              model.thoughtLevels.every(
                (level: unknown) =>
                  !!level &&
                  typeof level === "object" &&
                  typeof (level as { value?: unknown }).value === "string" &&
                  typeof (level as { name?: unknown }).name === "string",
              ))),
      )
    )
      throw new Error(`ACP model selection is invalid: ${id}`);
    if (
      entry.availableModels !== undefined &&
      !entry.availableModels.every(
        (model: unknown) =>
          !!model &&
          typeof model === "object" &&
          typeof (model as { id?: unknown }).id === "string" &&
          typeof (model as { name?: unknown }).name === "string",
      )
    )
      throw new Error(`ACP model catalog is invalid: ${id}`);
    result[id] = {
      fingerprint: entry.fingerprint,
      models: entry.models as SavedAcpModel[],
      ...(entry.availableModels
        ? { availableModels: entry.availableModels as SavedAcpModel[] }
        : {}),
    };
  }
  return result;
}

export async function readSavedAcpModels(
  id: string,
  fingerprint: string,
): Promise<readonly SavedAcpModel[]> {
  const entry = (await readDocument())[id];
  return entry?.fingerprint === fingerprint ? entry.models : [];
}

export async function readAcpModelCatalog(
  id: string,
  fingerprint: string,
): Promise<{ models: readonly SavedAcpModel[]; availableModels: readonly SavedAcpModel[] }> {
  const entry = (await readDocument())[id];
  if (!entry || entry.fingerprint !== fingerprint) return { models: [], availableModels: [] };
  return { models: entry.models, availableModels: entry.availableModels ?? entry.models };
}

export async function saveAcpModels(
  id: string,
  fingerprint: string,
  models: readonly SavedAcpModel[],
  availableModels: readonly SavedAcpModel[] = models,
): Promise<void> {
  const current = await readDocument();
  const next = {
    ...current,
    [id]: { fingerprint, models: [...models], availableModels: [...availableModels] },
  };
  const target = path();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
