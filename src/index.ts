#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/iluxu/codex-skills-registry/main/index.json";

type IndexSkill = {
  name: string;
  description?: string;
  author?: string;
  tags?: string[];
  compatibility?: string[];
  latest: string;
  artifact?: {
    url: string;
    sha256?: string;
    entry?: string;
  };
  manifest: string;
};

type RegistryIndex = {
  registry: string;
  version: string;
  updatedAt: string;
  skills: IndexSkill[];
};

type ManifestVersion = {
  version: string;
  releasedAt: string;
  artifact?: {
    url: string;
    sha256?: string;
    entry?: string;
  };
};

type SkillManifest = {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  entry?: string;
  tags?: string[];
  compatibility?: string[];
  install?: {
    type: string;
    destination?: string;
    notes?: string;
  };
  versions: ManifestVersion[];
};

const program = new Command();

program
  .name("codex-skill")
  .description("Manage Codex skills from a registry.")
  .version("0.1.0")
  .option("--registry <pathOrUrl>", "Registry index URL or file path");

program
  .command("list")
  .description("List skills from the registry.")
  .action(async () => {
    const index = await loadRegistryIndex();
    index.skills.forEach((skill) => {
      const tags = skill.tags?.length ? ` [${skill.tags.join(", ")}]` : "";
      const version = skill.latest ? ` (${skill.latest})` : "";
      console.log(`${skill.name}${version} — ${skill.description ?? ""}${tags}`.trim());
    });
  });

program
  .command("search")
  .description("Search skills by name, description, or tags.")
  .argument("<query>", "Search query")
  .action(async (query: string) => {
    const index = await loadRegistryIndex();
    const needle = query.toLowerCase();
    const results = index.skills.filter((skill) => {
      const haystack = [skill.name, skill.description ?? "", ...(skill.tags ?? [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });

    if (!results.length) {
      console.log("No skills found.");
      return;
    }

    results.forEach((skill) => {
      console.log(`${skill.name} — ${skill.description ?? ""}`.trim());
    });
  });

program
  .command("get")
  .description("Fetch a skill manifest.")
  .argument("<name>", "Skill name")
  .action(async (name: string) => {
    const { index, registrySource } = await loadRegistryIndexWithSource();
    const skill = findSkill(index, name);
    const manifest = await loadManifest(registrySource, skill.manifest);
    console.log(JSON.stringify(manifest, null, 2));
  });

program
  .command("install")
  .description("Download and install a skill artifact.")
  .argument("<name>", "Skill name")
  .option("--version <version>", "Specific version")
  .option("--to <path>", "Destination directory for skills")
  .option("--out <path>", "Output artifact path (optional)")
  .action(async (name: string, options: { version?: string; out?: string; to?: string }) => {
    const { index, registrySource } = await loadRegistryIndexWithSource();
    const skill = findSkill(index, name);
    const manifest = await loadManifest(registrySource, skill.manifest);
    const version = options.version ?? skill.latest;
    const entry = manifest.versions.find((item) => item.version === version);

    if (!entry) {
      throw new Error(`Version not found: ${version}`);
    }

    const artifact = entry.artifact ?? skill.artifact;
    if (!artifact?.url) {
      throw new Error("No artifact url available for this version.");
    }

    const artifactSource = resolveRelativeSource(registrySource, artifact.url);
    const outputPath = options.out
      ? path.resolve(process.cwd(), options.out)
      : await createTempFile(`${skill.name}-${version}.skill`);

    const buffer = await loadBinary(artifactSource);
    await fs.writeFile(outputPath, buffer);

    if (artifact.sha256) {
      const digest = sha256(buffer);
      if (digest !== artifact.sha256) {
        throw new Error(`SHA256 mismatch: expected ${artifact.sha256}, got ${digest}`);
      }
    }

    const destination = resolveSkillsDestination(options.to);
    await fs.mkdir(destination, { recursive: true });
    await unzipArchive(outputPath, destination);
    console.log(`Installed ${skill.name} to ${destination}`);
  });

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function loadRegistryIndex(): Promise<RegistryIndex> {
  const { index } = await loadRegistryIndexWithSource();
  return index;
}

async function loadRegistryIndexWithSource(): Promise<{ index: RegistryIndex; registrySource: string }> {
  const registrySource = resolveRegistrySource();
  const index = await loadJson<RegistryIndex>(registrySource);
  return { index, registrySource };
}

function resolveRegistrySource(): string {
  const opts = program.opts<{ registry?: string }>();
  if (opts.registry) {
    return opts.registry;
  }

  const envRegistry = process.env.REGISTRY_URL;
  if (envRegistry) {
    return envRegistry;
  }

  const localCandidates = [
    path.resolve(process.cwd(), "codex-skills-registry", "index.json"),
    path.resolve(process.cwd(), "..", "codex-skills-registry", "index.json"),
    path.resolve(process.cwd(), "repos", "codex-skills-registry", "index.json"),
    path.resolve(process.cwd(), "..", "repos", "codex-skills-registry", "index.json")
  ];
  for (const candidate of localCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_REGISTRY_URL;
}

function findSkill(index: RegistryIndex, name: string): IndexSkill {
  const normalized = name.trim().toLowerCase();
  const skill = index.skills.find((entry) => entry.name.toLowerCase() === normalized);
  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }
  return skill;
}

async function loadManifest(registrySource: string, manifestPath: string): Promise<SkillManifest> {
  const manifestSource = resolveRelativeSource(registrySource, manifestPath);
  return loadJson<SkillManifest>(manifestSource);
}

function resolveRelativeSource(base: string, relativePath: string): string {
  if (isHttp(relativePath) || relativePath.startsWith("file://")) {
    return relativePath;
  }

  if (isHttp(base)) {
    return new URL(relativePath, base).toString();
  }

  if (base.startsWith("file://")) {
    const basePath = new URL(base).pathname;
    return path.resolve(path.dirname(basePath), relativePath);
  }

  return path.resolve(path.dirname(base), relativePath);
}

async function loadJson<T>(source: string): Promise<T> {
  if (isHttp(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: ${response.status}`);
    }
    return (await response.json()) as T;
  }

  const filePath = source.startsWith("file://") ? new URL(source).pathname : source;
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

async function loadBinary(source: string): Promise<Buffer> {
  if (isHttp(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${source}: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  const filePath = source.startsWith("file://") ? new URL(source).pathname : source;
  return fs.readFile(filePath);
}

function isHttp(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function resolveSkillsDestination(target?: string): string {
  if (target) {
    return path.resolve(process.cwd(), target);
  }

  const codexHome = process.env.CODEX_HOME;
  if (codexHome) {
    return path.join(codexHome, "skills");
  }

  return path.join(os.homedir(), ".codex", "skills");
}

async function createTempFile(filename: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-skill-"));
  return path.join(dir, filename);
}

async function unzipArchive(zipPath: string, destination: string): Promise<void> {
  try {
    await runCommand("unzip", ["-o", zipPath, "-d", destination]);
    return;
  } catch (error) {
    if (process.platform === "win32" && isMissingCommand(error)) {
      const script = [
        "Expand-Archive",
        "-LiteralPath",
        `'${escapePowerShell(zipPath)}'`,
        "-DestinationPath",
        `'${escapePowerShell(destination)}'`,
        "-Force"
      ].join(" ");
      await runCommand("powershell", ["-NoProfile", "-Command", script]);
      return;
    }
    if (isMissingCommand(error)) {
      throw new Error("unzip not found. Install unzip or extract the .skill manually.");
    }
    throw error;
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} failed with code ${code ?? "unknown"}`));
      }
    });
  });
}

function isMissingCommand(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}
