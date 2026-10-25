import path from 'node:path';
import type {
  AnalysisFileInfo,
  AnalysisSuggestion,
  Feature,
  Idea,
  ProjectAnalysisResult,
} from '@automaker/types';
import { getAppSpecPath } from '@automaker/platform';
import { createLogger, isAbortError, type AtomicWriteFilesystem } from '@automaker/utils';
import { extractXmlElements, extractImplementedFeatures } from '../../lib/xml-extractor.js';

const logger = createLogger('IdeationService');
type ContextFilesystem = Pick<AtomicWriteFilesystem, 'readFile'> &
  Pick<typeof import('../../lib/secure-fs.js'), 'readdir'>;

/** Read-only project context and structure collaborator. Accepted-job lifetime belongs to IdeationService. */
export class IdeationProjectContextReader {
  constructor(
    private readonly filesystem: ContextFilesystem,
    private readonly featureLoader: { getAll(projectPath: string): Promise<Feature[]> } | null,
    private readonly getIdeas: (projectPath: string) => Promise<Idea[]>,
    private readonly getCachedAnalysis: (
      projectPath: string
    ) => Promise<ProjectAnalysisResult | null>,
    private readonly generateId: (prefix: string) => string
  ) {}
  async buildAppSpecContext(projectPath: string): Promise<string> {
    try {
      const specPath = getAppSpecPath(projectPath);
      const specContent = (await this.filesystem.readFile(specPath, 'utf-8')) as string;

      const parts: string[] = [];
      parts.push('## App Specification');

      // Extract project name
      const projectNames = extractXmlElements(specContent, 'project_name');
      if (projectNames.length > 0 && projectNames[0]) {
        parts.push(`**Project:** ${projectNames[0]}`);
      }

      // Extract overview
      const overviews = extractXmlElements(specContent, 'overview');
      if (overviews.length > 0 && overviews[0]) {
        parts.push(`**Overview:** ${overviews[0]}`);
      }

      // Extract core capabilities
      const capabilities = extractXmlElements(specContent, 'capability');
      if (capabilities.length > 0) {
        parts.push('**Core Capabilities:**');
        for (const cap of capabilities) {
          parts.push(`- ${cap}`);
        }
      }

      // Extract implemented features
      const implementedFeatures = extractImplementedFeatures(specContent);
      if (implementedFeatures.length > 0) {
        parts.push('**Implemented Features:**');
        for (const feature of implementedFeatures) {
          if (feature.description) {
            parts.push(`- ${feature.name}: ${feature.description}`);
          } else {
            parts.push(`- ${feature.name}`);
          }
        }
      }

      // Only return content if we extracted something meaningful
      if (parts.length > 1) {
        return parts.join('\n');
      }
      return '';
    } catch (error) {
      // If file doesn't exist, return empty string silently
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      // For other errors, log and return empty string
      logger.warn('Failed to build app spec context:', error);
      return '';
    }
  }

  async gatherBasicProjectInfo(projectPath: string): Promise<string | null> {
    const parts: string[] = [];

    // Try to read package.json
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = (await this.filesystem.readFile(packageJsonPath, 'utf-8')) as string;
      const pkg = JSON.parse(content);

      parts.push('## Project Information (from package.json)');
      if (pkg.name) parts.push(`**Name:** ${pkg.name}`);
      if (pkg.description) parts.push(`**Description:** ${pkg.description}`);
      if (pkg.version) parts.push(`**Version:** ${pkg.version}`);

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const depNames = Object.keys(allDeps);

      // Detect framework and language
      let framework = 'Unknown';
      if (allDeps.react) framework = allDeps.next ? 'Next.js' : 'React';
      else if (allDeps.vue) framework = allDeps.nuxt ? 'Nuxt' : 'Vue';
      else if (allDeps['@angular/core']) framework = 'Angular';
      else if (allDeps.svelte) framework = 'Svelte';
      else if (allDeps.express) framework = 'Express';
      else if (allDeps.fastify) framework = 'Fastify';
      else if (allDeps.koa) framework = 'Koa';

      const language = allDeps.typescript ? 'TypeScript' : 'JavaScript';
      parts.push(`**Tech Stack:** ${framework} with ${language}`);

      // Key dependencies
      const keyDeps = depNames
        .filter(
          (d) => !d.startsWith('@types/') && !['typescript', 'eslint', 'prettier'].includes(d)
        )
        .slice(0, 15);
      if (keyDeps.length > 0) {
        parts.push(`**Key Dependencies:** ${keyDeps.join(', ')}`);
      }

      // Scripts
      if (pkg.scripts) {
        const scriptNames = Object.keys(pkg.scripts).slice(0, 10);
        parts.push(`**Available Scripts:** ${scriptNames.join(', ')}`);
      }
    } catch {
      // No package.json, try other files
    }

    // Try to read README.md (first 500 chars)
    try {
      const readmePath = path.join(projectPath, 'README.md');
      const content = (await this.filesystem.readFile(readmePath, 'utf-8')) as string;
      if (content) {
        parts.push('\n## README.md (excerpt)');
        parts.push(content.slice(0, 1000));
      }
    } catch {
      // No README
    }

    // Try to get cached analysis
    const cachedAnalysis = await this.getCachedAnalysis(projectPath);
    if (cachedAnalysis) {
      parts.push('\n## Project Structure Analysis');
      parts.push(cachedAnalysis.summary || '');
      if (cachedAnalysis.routes && cachedAnalysis.routes.length > 0) {
        parts.push(`**Routes:** ${cachedAnalysis.routes.map((r) => r.name).join(', ')}`);
      }
      if (cachedAnalysis.components && cachedAnalysis.components.length > 0) {
        parts.push(
          `**Components:** ${cachedAnalysis.components
            .slice(0, 10)
            .map((c) => c.name)
            .join(
              ', '
            )}${cachedAnalysis.components.length > 10 ? ` and ${cachedAnalysis.components.length - 10} more` : ''}`
        );
      }
    }

    if (parts.length === 0) {
      return null;
    }

    return parts.join('\n');
  }

  async gatherExistingWorkContext(
    projectPath: string,
    options?: { includeFeatures?: boolean; includeIdeas?: boolean }
  ): Promise<string> {
    const { includeFeatures = true, includeIdeas = true } = options ?? {};
    const parts: string[] = [];

    // Load existing features from the board
    if (includeFeatures && this.featureLoader) {
      try {
        const features = await this.featureLoader.getAll(projectPath);
        if (features.length > 0) {
          parts.push('## Existing Features (Do NOT regenerate these)');
          parts.push(
            'The following features already exist on the board. Do NOT suggest similar ideas:\n'
          );

          // Group features by status for clarity
          const byStatus: Record<string, string[]> = {
            done: [],
            'in-review': [],
            'in-progress': [],
            backlog: [],
          };

          for (const feature of features) {
            const status = feature.status || 'backlog';
            const title = feature.title || 'Untitled';
            if (byStatus[status]) {
              byStatus[status].push(title);
            } else {
              byStatus['backlog'].push(title);
            }
          }

          // Output completed features first (most important to not duplicate)
          if (byStatus['done'].length > 0) {
            parts.push(`**Completed:** ${byStatus['done'].join(', ')}`);
          }
          if (byStatus['in-review'].length > 0) {
            parts.push(`**In Review:** ${byStatus['in-review'].join(', ')}`);
          }
          if (byStatus['in-progress'].length > 0) {
            parts.push(`**In Progress:** ${byStatus['in-progress'].join(', ')}`);
          }
          if (byStatus['backlog'].length > 0) {
            parts.push(`**Backlog:** ${byStatus['backlog'].join(', ')}`);
          }
          parts.push('');
        }
      } catch (error) {
        logger.warn('Failed to load existing features:', error);
      }
    }

    // Load existing ideas
    if (includeIdeas) {
      try {
        const ideas = await this.getIdeas(projectPath);
        // Filter out archived ideas
        const activeIdeas = ideas.filter((idea) => idea.status !== 'archived');

        if (activeIdeas.length > 0) {
          parts.push('## Existing Ideas (Do NOT regenerate these)');
          parts.push(
            'The following ideas have already been captured. Do NOT suggest similar ideas:\n'
          );

          // Group by category for organization
          const byCategory: Record<string, string[]> = {};
          for (const idea of activeIdeas) {
            const cat = idea.category || 'feature';
            if (!byCategory[cat]) {
              byCategory[cat] = [];
            }
            byCategory[cat].push(idea.title);
          }

          for (const [category, titles] of Object.entries(byCategory)) {
            parts.push(`**${category}:** ${titles.join(', ')}`);
          }
          parts.push('');
        }
      } catch (error) {
        logger.warn('Failed to load existing ideas:', error);
      }
    }

    return parts.join('\n');
  }

  async gatherProjectStructure(
    projectPath: string,
    signal?: AbortSignal
  ): Promise<{
    totalFiles: number;
    routes: AnalysisFileInfo[];
    components: AnalysisFileInfo[];
    services: AnalysisFileInfo[];
    framework?: string;
    language?: string;
    dependencies?: string[];
  }> {
    const routes: AnalysisFileInfo[] = [];
    const components: AnalysisFileInfo[] = [];
    const services: AnalysisFileInfo[] = [];
    let totalFiles = 0;
    let framework: string | undefined;
    let language: string | undefined;
    const dependencies: string[] = [];

    // Check for package.json to detect framework and dependencies
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = (await this.filesystem.readFile(packageJsonPath, 'utf-8')) as string;
      const pkg = JSON.parse(content);

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      dependencies.push(...Object.keys(allDeps).slice(0, 20)); // Top 20 deps

      if (allDeps.react) framework = 'React';
      else if (allDeps.vue) framework = 'Vue';
      else if (allDeps.angular) framework = 'Angular';
      else if (allDeps.next) framework = 'Next.js';
      else if (allDeps.express) framework = 'Express';

      language = allDeps.typescript ? 'TypeScript' : 'JavaScript';
    } catch {
      // No package.json
    }

    // Scan common directories
    const scanPatterns = [
      { dir: 'src/routes', type: 'route' as const },
      { dir: 'src/pages', type: 'route' as const },
      { dir: 'app', type: 'route' as const },
      { dir: 'src/components', type: 'component' as const },
      { dir: 'components', type: 'component' as const },
      { dir: 'src/services', type: 'service' as const },
      { dir: 'src/lib', type: 'service' as const },
      { dir: 'lib', type: 'service' as const },
    ];

    for (const pattern of scanPatterns) {
      signal?.throwIfAborted();
      const fullPath = path.join(projectPath, pattern.dir);
      try {
        const files = await this.scanDirectory(fullPath, pattern.type, signal);
        totalFiles += files.length;

        if (pattern.type === 'route') routes.push(...files);
        else if (pattern.type === 'component') components.push(...files);
        else if (pattern.type === 'service') services.push(...files);
      } catch {
        // Directory doesn't exist
      }
    }

    return {
      totalFiles,
      routes: routes.slice(0, 20),
      components: components.slice(0, 30),
      services: services.slice(0, 20),
      framework,
      language,
      dependencies,
    };
  }

  async scanDirectory(
    dirPath: string,
    type: 'route' | 'component' | 'service' | 'model' | 'config' | 'test' | 'other',
    signal?: AbortSignal
  ): Promise<AnalysisFileInfo[]> {
    const results: AnalysisFileInfo[] = [];
    signal?.throwIfAborted();
    try {
      const entries = (await this.filesystem.readdir(dirPath, {
        withFileTypes: true,
      })) as import('fs').Dirent[];

      for (const entry of entries) {
        signal?.throwIfAborted();
        if (entry.isDirectory()) {
          const subResults = await this.scanDirectory(path.join(dirPath, entry.name), type, signal);
          results.push(...subResults);
        } else if (entry.isFile() && this.isCodeFile(entry.name)) {
          results.push({
            path: path.join(dirPath, entry.name),
            type,
            name: entry.name.replace(/\.(tsx?|jsx?|vue)$/, ''),
          });
        }
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      // Preserve missing directory fallback.
    }

    return results;
  }

  isCodeFile(filename: string): boolean {
    return (
      /\.(tsx?|jsx?|vue|svelte)$/.test(filename) &&
      !filename.includes('.test.') &&
      !filename.includes('.spec.')
    );
  }

  async generateAnalysisSuggestions(
    _projectPath: string,
    structure: Awaited<ReturnType<typeof this.gatherProjectStructure>>
  ): Promise<AnalysisSuggestion[]> {
    // Generate basic suggestions based on project structure analysis
    const suggestions: AnalysisSuggestion[] = [];

    if (structure.routes.length > 0 && structure.routes.length < 5) {
      suggestions.push({
        id: this.generateId('sug'),
        category: 'feature',
        title: 'Expand Core Functionality',
        description: 'The app has a small number of routes. Consider adding more features.',
        rationale: `Only ${structure.routes.length} routes detected. Most apps benefit from additional navigation options.`,
        priority: 'medium',
      });
    }

    if (
      !structure.dependencies?.includes('react-query') &&
      !structure.dependencies?.includes('@tanstack/react-query')
    ) {
      suggestions.push({
        id: this.generateId('sug'),
        category: 'technical',
        title: 'Add Data Fetching Library',
        description: 'Consider adding React Query or similar for better data management.',
        rationale:
          'Data fetching libraries provide caching, background updates, and better loading states.',
        priority: 'low',
      });
    }

    return suggestions;
  }

  generateAnalysisSummary(
    structure: Awaited<ReturnType<typeof this.gatherProjectStructure>>,
    suggestions: AnalysisSuggestion[]
  ): string {
    const parts: string[] = [];

    if (structure.framework) {
      parts.push(`${structure.framework} ${structure.language || ''} application`);
    }

    parts.push(`with ${structure.totalFiles} code files`);
    parts.push(`${structure.routes.length} routes`);
    parts.push(`${structure.components.length} components`);
    parts.push(`${structure.services.length} services`);

    const summary = parts.join(', ');
    const highPriority = suggestions.filter((s) => s.priority === 'high').length;

    return `${summary}. Found ${suggestions.length} improvement opportunities${highPriority > 0 ? ` (${highPriority} high priority)` : ''}.`;
  }
}
