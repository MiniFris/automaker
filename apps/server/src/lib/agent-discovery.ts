/**
 * Agent Discovery - Scans filesystem for AGENT.md files
 *
 * Discovers agents from:
 * - ~/.claude/agents/ (user-level, global)
 * - .claude/agents/ (project-level)
 *
 * Similar to Skills, but for custom subagents defined in AGENT.md files.
 */

import path from 'path';
import os from 'os';
import { createLogger } from '@automaker/utils';
import { secureFs, systemPaths } from '@automaker/platform';
import type { AgentDefinition } from '@automaker/types';

const logger = createLogger('AgentDiscovery');

export interface FilesystemAgent {
  name: string; // Directory name (e.g., 'code-reviewer')
  definition: AgentDefinition;
  source: 'user' | 'project';
  filePath: string; // Full path to AGENT.md
}

/**
 * Parse agent content string into AgentDefinition
 * Format:
 * ---
 * name: agent-name  # Optional
 * description: When to use this agent
 * tools: tool1, tool2, tool3  # Optional (comma or space separated list)
 * model: sonnet  # Optional: sonnet, opus, haiku
 * ---
 * System prompt content here...
 */
function parseAgentContent(content: string, filePath: string): AgentDefinition | null {
  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    logger.warn(`Invalid agent file format (missing frontmatter): ${filePath}`);
    return null;
  }

  const [, frontmatter, prompt] = frontmatterMatch;

  // Parse description (required)
  const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim();
  if (!description) {
    logger.warn(`Missing description in agent file: ${filePath}`);
    return null;
  }

  // Parse tools (optional) - supports both comma-separated and space-separated
  const toolsMatch = frontmatter.match(/tools:\s*(.+)/);
  const tools = toolsMatch
    ? toolsMatch[1]
        .split(/[,\s]+/) // Split by comma or whitespace
        .map((t) => t.trim())
        .filter((t) => t && t !== '')
    : undefined;

  // Parse model (optional) - validate against allowed values
  const modelMatch = frontmatter.match(/model:\s*(\w+)/);
  const modelValue = modelMatch?.[1]?.trim();
  const validModels = ['sonnet', 'opus', 'haiku', 'inherit'] as const;
  const model =
    modelValue && validModels.includes(modelValue as (typeof validModels)[number])
      ? (modelValue as 'sonnet' | 'opus' | 'haiku' | 'inherit')
      : undefined;

  if (modelValue && !model) {
    logger.warn(
      `Invalid model "${modelValue}" in agent file: ${filePath}. Expected one of: ${validModels.join(', ')}`
    );
  }

  return {
    description,
    prompt: prompt.trim(),
    tools,
    model,
  };
}

/**
 * Directory entry with type information
 */
export interface AgentDiscoveryEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

/**
 * Filesystem adapter interface for abstracting systemPaths vs secureFs
 */
export interface AgentDiscoveryFilesystem {
  exists: (filePath: string) => Promise<boolean>;
  readdir: (dirPath: string) => Promise<AgentDiscoveryEntry[]>;
  readFile: (filePath: string) => Promise<string>;
}

export interface AgentDiscoveryRuntime {
  userDirectory?: string;
  userFilesystem: AgentDiscoveryFilesystem;
  projectFilesystem: AgentDiscoveryFilesystem;
}

/**
 * Create a filesystem adapter for system paths (user directory)
 */
function createSystemPathAdapter(): AgentDiscoveryFilesystem {
  return {
    exists: (filePath) => Promise.resolve(systemPaths.systemPathExists(filePath)),
    readdir: async (dirPath) => {
      const entryNames = await systemPaths.systemPathReaddir(dirPath);
      const entries: AgentDiscoveryEntry[] = [];
      for (const name of entryNames) {
        const stat = await systemPaths.systemPathStat(path.join(dirPath, name));
        entries.push({
          name,
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
        });
      }
      return entries;
    },
    readFile: (filePath) => systemPaths.systemPathReadFile(filePath, 'utf-8') as Promise<string>,
  };
}

/**
 * Create a filesystem adapter for project paths (secureFs)
 */
export function createAgentDiscoveryAdapter(
  filesystem: Pick<typeof secureFs, 'access' | 'readdir' | 'readFile'>
): AgentDiscoveryFilesystem {
  return {
    exists: (filePath) =>
      filesystem
        .access(filePath)
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        }),
    readdir: async (dirPath) => {
      const entries = await filesystem.readdir(dirPath, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
      }));
    },
    readFile: (filePath) => filesystem.readFile(filePath, 'utf-8') as Promise<string>,
  };
}

/**
 * Parse agent file using the provided filesystem adapter
 */
async function parseAgentFileWithAdapter(
  filePath: string,
  fsAdapter: AgentDiscoveryFilesystem,
  strict: boolean
): Promise<AgentDefinition | null> {
  try {
    const content = await fsAdapter.readFile(filePath);
    return parseAgentContent(content, filePath);
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    logger.error(`Failed to parse agent file: ${filePath}`, error);
    return null;
  }
}

/**
 * Scan a directory for agent .md files
 * Agents can be in two formats:
 * 1. Flat: agent-name.md (file directly in agents/)
 * 2. Subdirectory: agent-name/AGENT.md (folder + file, similar to Skills)
 */
async function scanAgentsDirectory(
  baseDir: string,
  source: 'user' | 'project',
  fsAdapter: AgentDiscoveryFilesystem,
  strict: boolean
): Promise<FilesystemAgent[]> {
  const agents: FilesystemAgent[] = [];

  try {
    // Check if directory exists
    const exists = await fsAdapter.exists(baseDir);
    if (!exists) {
      logger.debug(`Directory does not exist: ${baseDir}`);
      return agents;
    }

    // Read all entries in the directory
    const entries = await fsAdapter.readdir(baseDir);

    for (const entry of entries) {
      // Check for flat .md file format (agent-name.md)
      if (entry.isFile && entry.name.endsWith('.md')) {
        const agentName = entry.name.slice(0, -3); // Remove .md extension
        const agentFilePath = path.join(baseDir, entry.name);
        const definition = await parseAgentFileWithAdapter(agentFilePath, fsAdapter, strict);
        if (definition) {
          agents.push({
            name: agentName,
            definition,
            source,
            filePath: agentFilePath,
          });
          logger.debug(`Discovered ${source} agent (flat): ${agentName}`);
        }
      }
      // Check for subdirectory format (agent-name/AGENT.md)
      else if (entry.isDirectory) {
        const agentFilePath = path.join(baseDir, entry.name, 'AGENT.md');
        const agentFileExists = await fsAdapter.exists(agentFilePath);

        if (agentFileExists) {
          const definition = await parseAgentFileWithAdapter(agentFilePath, fsAdapter, strict);
          if (definition) {
            agents.push({
              name: entry.name,
              definition,
              source,
              filePath: agentFilePath,
            });
            logger.debug(`Discovered ${source} agent (subdirectory): ${entry.name}`);
          }
        }
      }
    }
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    logger.error(`Failed to scan agents directory: ${baseDir}`, error);
  }

  return agents;
}

/**
 * Discover all filesystem-based agents from user and project sources
 */
export async function discoverFilesystemAgents(
  projectPath?: string,
  sources: Array<'user' | 'project'> = ['user', 'project'],
  runtime?: AgentDiscoveryRuntime
): Promise<FilesystemAgent[]> {
  const agents: FilesystemAgent[] = [];

  // Discover user-level agents from ~/.claude/agents/
  const userAgentsDir = runtime
    ? runtime.userDirectory
    : path.join(os.homedir(), '.claude', 'agents');
  if (sources.includes('user') && userAgentsDir) {
    const userAgents = await scanAgentsDirectory(
      userAgentsDir,
      'user',
      runtime?.userFilesystem ?? createSystemPathAdapter(),
      !!runtime
    );
    agents.push(...userAgents);
    logger.info(`Discovered ${userAgents.length} user-level agents from ${userAgentsDir}`);
  }

  // Discover project-level agents from .claude/agents/
  if (sources.includes('project') && projectPath) {
    const projectAgentsDir = path.join(projectPath, '.claude', 'agents');
    const projectAgents = await scanAgentsDirectory(
      projectAgentsDir,
      'project',
      runtime?.projectFilesystem ?? createAgentDiscoveryAdapter(secureFs),
      !!runtime
    );
    agents.push(...projectAgents);
    logger.info(`Discovered ${projectAgents.length} project-level agents from ${projectAgentsDir}`);
  }

  return agents;
}
