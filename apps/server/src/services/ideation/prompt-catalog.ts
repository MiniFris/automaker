import type { IdeaCategory, IdeationPrompt, PromptCategory } from '@automaker/types';

/** Pure guided prompt data and assembly; no session, provider or filesystem ownership. */
export class IdeationPromptCatalog {
  getPromptCategories(): PromptCategory[] {
    return [
      {
        id: 'feature',
        name: 'Features',
        icon: 'Zap',
        description: 'New capabilities and functionality',
      },
      {
        id: 'ux-ui',
        name: 'UX/UI',
        icon: 'Palette',
        description: 'Design and user experience improvements',
      },
      {
        id: 'dx',
        name: 'Developer Experience',
        icon: 'Code',
        description: 'Developer tooling and workflows',
      },
      {
        id: 'growth',
        name: 'Growth',
        icon: 'TrendingUp',
        description: 'User engagement and retention',
      },
      {
        id: 'technical',
        name: 'Technical',
        icon: 'Cpu',
        description: 'Architecture and infrastructure',
      },
      {
        id: 'security',
        name: 'Security',
        icon: 'Shield',
        description: 'Security improvements and vulnerability fixes',
      },
      {
        id: 'performance',
        name: 'Performance',
        icon: 'Gauge',
        description: 'Performance optimization and speed improvements',
      },
      {
        id: 'accessibility',
        name: 'Accessibility',
        icon: 'Accessibility',
        description: 'Accessibility features and inclusive design',
      },
      {
        id: 'analytics',
        name: 'Analytics',
        icon: 'BarChart',
        description: 'Analytics, monitoring, and insights features',
      },
    ];
  }

  getPromptsByCategory(category: IdeaCategory): IdeationPrompt[] {
    const allPrompts = this.getAllPrompts();
    return allPrompts.filter((p) => p.category === category);
  }

  getAllPrompts(): IdeationPrompt[] {
    return [
      // Feature prompts
      {
        id: 'feature-missing',
        category: 'feature',
        title: 'Missing Features',
        description: 'Discover features users might expect',
        prompt:
          "Based on the project context provided, identify features that users of similar applications typically expect but might be missing. Consider the app's domain, target users, and common patterns in similar products.",
      },
      {
        id: 'feature-automation',
        category: 'feature',
        title: 'Automation Opportunities',
        description: 'Find manual processes that could be automated',
        prompt:
          'Based on the project context, identify manual processes or repetitive tasks that could be automated. Look for patterns where users might be doing things repeatedly that software could handle.',
      },
      {
        id: 'feature-integrations',
        category: 'feature',
        title: 'Integration Ideas',
        description: 'Identify valuable third-party integrations',
        prompt:
          "Based on the project context, what third-party services or APIs would provide value if integrated? Consider the app's domain and what complementary services users might need.",
      },
      {
        id: 'feature-workflow',
        category: 'feature',
        title: 'Workflow Improvements',
        description: 'Streamline user workflows',
        prompt:
          'Based on the project context, analyze the user workflows. What steps could be combined, eliminated, or automated? Where are users likely spending too much time on repetitive tasks?',
      },

      // UX/UI prompts
      {
        id: 'ux-friction',
        category: 'ux-ui',
        title: 'Friction Points',
        description: 'Identify where users might get stuck',
        prompt:
          'Based on the project context, identify potential user friction points. Where might users get confused, stuck, or frustrated? Consider form submissions, navigation, error states, and complex interactions.',
      },
      {
        id: 'ux-empty-states',
        category: 'ux-ui',
        title: 'Empty States',
        description: 'Improve empty state experiences',
        prompt:
          "Based on the project context, identify empty states that could be improved. How can we guide users when there's no content? Consider onboarding, helpful prompts, and sample data.",
      },
      {
        id: 'ux-accessibility',
        category: 'ux-ui',
        title: 'Accessibility Improvements',
        description: 'Enhance accessibility and inclusivity',
        prompt:
          'Based on the project context, suggest accessibility improvements. Consider keyboard navigation, screen reader support, color contrast, focus states, and ARIA labels. What specific improvements would make this more accessible?',
      },
      {
        id: 'ux-mobile',
        category: 'ux-ui',
        title: 'Mobile Experience',
        description: 'Optimize for mobile users',
        prompt:
          'Based on the project context, suggest improvements for the mobile user experience. Consider touch targets, responsive layouts, and mobile-specific interactions.',
      },
      {
        id: 'ux-feedback',
        category: 'ux-ui',
        title: 'User Feedback',
        description: 'Improve feedback and status indicators',
        prompt:
          'Based on the project context, analyze how the application communicates with users. Where are loading states, success messages, or error handling missing or unclear? What feedback would help users understand what is happening?',
      },

      // DX prompts
      {
        id: 'dx-documentation',
        category: 'dx',
        title: 'Documentation Gaps',
        description: 'Identify missing documentation',
        prompt:
          'Based on the project context, identify areas that could benefit from better documentation. What would help new developers understand the architecture, APIs, and conventions? Consider inline comments, READMEs, and API docs.',
      },
      {
        id: 'dx-testing',
        category: 'dx',
        title: 'Testing Improvements',
        description: 'Enhance test coverage and quality',
        prompt:
          'Based on the project context, suggest areas that need better test coverage. What types of tests might be missing? Consider unit tests, integration tests, and end-to-end tests.',
      },
      {
        id: 'dx-tooling',
        category: 'dx',
        title: 'Developer Tooling',
        description: 'Improve development workflows',
        prompt:
          'Based on the project context, suggest improvements to development workflows. What improvements would speed up development? Consider build times, hot reload, debugging tools, and developer scripts.',
      },
      {
        id: 'dx-error-handling',
        category: 'dx',
        title: 'Error Handling',
        description: 'Improve error messages and debugging',
        prompt:
          'Based on the project context, analyze error handling. Where are error messages unclear or missing? What would help developers debug issues faster? Consider logging, error boundaries, and stack traces.',
      },

      // Growth prompts
      {
        id: 'growth-onboarding',
        category: 'growth',
        title: 'Onboarding Flow',
        description: 'Improve new user experience',
        prompt:
          'Based on the project context, suggest improvements to the onboarding experience. How can we help new users understand the value and get started quickly? Consider tutorials, progressive disclosure, and quick wins.',
      },
      {
        id: 'growth-engagement',
        category: 'growth',
        title: 'User Engagement',
        description: 'Increase user retention and activity',
        prompt:
          'Based on the project context, suggest features that would increase user engagement and retention. What would bring users back daily? Consider notifications, streaks, social features, and personalization.',
      },
      {
        id: 'growth-sharing',
        category: 'growth',
        title: 'Shareability',
        description: 'Make the app more shareable',
        prompt:
          'Based on the project context, suggest ways to make the application more shareable. What features would encourage users to invite others or share their work? Consider collaboration, public profiles, and export features.',
      },
      {
        id: 'growth-monetization',
        category: 'growth',
        title: 'Monetization Ideas',
        description: 'Identify potential revenue streams',
        prompt:
          'Based on the project context, what features or tiers could support monetization? Consider premium features, usage limits, team features, and integrations that users would pay for.',
      },

      // Technical prompts
      {
        id: 'tech-performance',
        category: 'technical',
        title: 'Performance Optimization',
        description: 'Identify performance bottlenecks',
        prompt:
          'Based on the project context, suggest performance optimization opportunities. Where might bottlenecks exist? Consider database queries, API calls, bundle size, rendering, and caching strategies.',
      },
      {
        id: 'tech-architecture',
        category: 'technical',
        title: 'Architecture Review',
        description: 'Evaluate and improve architecture',
        prompt:
          'Based on the project context, suggest architectural improvements. What would make the codebase more maintainable, scalable, or testable? Consider separation of concerns, dependency management, and patterns.',
      },
      {
        id: 'tech-debt',
        category: 'technical',
        title: 'Technical Debt',
        description: 'Identify areas needing refactoring',
        prompt:
          'Based on the project context, identify potential technical debt. What areas might be becoming hard to maintain or understand? What refactoring would have the highest impact? Consider duplicated code, complexity, and outdated patterns.',
      },
      {
        id: 'tech-security',
        category: 'technical',
        title: 'Security Review',
        description: 'Identify security improvements',
        prompt:
          'Based on the project context, review for security improvements. What best practices are missing? Consider authentication, authorization, input validation, and data protection. Note: This is for improvement suggestions, not a security audit.',
      },

      // Security prompts
      {
        id: 'security-auth',
        category: 'security',
        title: 'Authentication Security',
        description: 'Review authentication mechanisms',
        prompt:
          'Based on the project context, analyze the authentication system. What security improvements would strengthen user authentication? Consider password policies, session management, MFA, and token handling.',
      },
      {
        id: 'security-data',
        category: 'security',
        title: 'Data Protection',
        description: 'Protect sensitive user data',
        prompt:
          'Based on the project context, review how sensitive data is handled. What improvements would better protect user privacy? Consider encryption, data minimization, secure storage, and data retention policies.',
      },
      {
        id: 'security-input',
        category: 'security',
        title: 'Input Validation',
        description: 'Prevent injection attacks',
        prompt:
          'Based on the project context, analyze input handling. Where could input validation be strengthened? Consider SQL injection, XSS, command injection, and file upload vulnerabilities.',
      },
      {
        id: 'security-api',
        category: 'security',
        title: 'API Security',
        description: 'Secure API endpoints',
        prompt:
          'Based on the project context, review API security. What improvements would make the API more secure? Consider rate limiting, authorization, CORS, and request validation.',
      },

      // Performance prompts
      {
        id: 'perf-frontend',
        category: 'performance',
        title: 'Frontend Performance',
        description: 'Optimize UI rendering and loading',
        prompt:
          'Based on the project context, analyze frontend performance. What optimizations would improve load times and responsiveness? Consider bundle splitting, lazy loading, memoization, and render optimization.',
      },
      {
        id: 'perf-backend',
        category: 'performance',
        title: 'Backend Performance',
        description: 'Optimize server-side operations',
        prompt:
          'Based on the project context, review backend performance. What optimizations would improve response times? Consider database queries, caching strategies, async operations, and resource pooling.',
      },
      {
        id: 'perf-database',
        category: 'performance',
        title: 'Database Optimization',
        description: 'Improve query performance',
        prompt:
          'Based on the project context, analyze database interactions. What optimizations would improve data access performance? Consider indexing, query optimization, denormalization, and connection pooling.',
      },
      {
        id: 'perf-caching',
        category: 'performance',
        title: 'Caching Strategies',
        description: 'Implement effective caching',
        prompt:
          'Based on the project context, review caching opportunities. Where would caching provide the most benefit? Consider API responses, computed values, static assets, and session data.',
      },

      // Accessibility prompts
      {
        id: 'a11y-keyboard',
        category: 'accessibility',
        title: 'Keyboard Navigation',
        description: 'Enable full keyboard access',
        prompt:
          'Based on the project context, analyze keyboard accessibility. What improvements would enable users to navigate entirely with keyboard? Consider focus management, tab order, and keyboard shortcuts.',
      },
      {
        id: 'a11y-screen-reader',
        category: 'accessibility',
        title: 'Screen Reader Support',
        description: 'Improve screen reader experience',
        prompt:
          'Based on the project context, review screen reader compatibility. What improvements would help users with visual impairments? Consider ARIA labels, semantic HTML, live regions, and alt text.',
      },
      {
        id: 'a11y-visual',
        category: 'accessibility',
        title: 'Visual Accessibility',
        description: 'Improve visual design for all users',
        prompt:
          'Based on the project context, analyze visual accessibility. What improvements would help users with visual impairments? Consider color contrast, text sizing, focus indicators, and reduced motion.',
      },
      {
        id: 'a11y-forms',
        category: 'accessibility',
        title: 'Accessible Forms',
        description: 'Make forms usable for everyone',
        prompt:
          'Based on the project context, review form accessibility. What improvements would make forms more accessible? Consider labels, error messages, required field indicators, and input assistance.',
      },

      // Analytics prompts
      {
        id: 'analytics-tracking',
        category: 'analytics',
        title: 'User Tracking',
        description: 'Track key user behaviors',
        prompt:
          'Based on the project context, analyze analytics opportunities. What user behaviors should be tracked to understand engagement? Consider page views, feature usage, conversion funnels, and session duration.',
      },
      {
        id: 'analytics-metrics',
        category: 'analytics',
        title: 'Key Metrics',
        description: 'Define success metrics',
        prompt:
          'Based on the project context, what key metrics should be tracked? Consider user acquisition, retention, engagement, and feature adoption. What dashboards would be most valuable?',
      },
      {
        id: 'analytics-errors',
        category: 'analytics',
        title: 'Error Monitoring',
        description: 'Track and analyze errors',
        prompt:
          'Based on the project context, review error handling for monitoring opportunities. What error tracking would help identify and fix issues faster? Consider error aggregation, alerting, and stack traces.',
      },
      {
        id: 'analytics-performance',
        category: 'analytics',
        title: 'Performance Monitoring',
        description: 'Track application performance',
        prompt:
          'Based on the project context, analyze performance monitoring opportunities. What metrics would help identify bottlenecks? Consider load times, API response times, and resource usage.',
      },
    ];
  }

  buildIdeationSystemPrompt(
    basePrompt: string,
    contextFilesPrompt: string | undefined,
    category?: IdeaCategory,
    existingWorkContext?: string
  ): string {
    const categoryContext = category
      ? `\n\nFocus area: ${this.getCategoryDescription(category)}`
      : '';

    const contextSection = contextFilesPrompt
      ? `\n\n## Project Context\n${contextFilesPrompt}`
      : '';

    const existingWorkSection = existingWorkContext ? `\n\n${existingWorkContext}` : '';

    return basePrompt + categoryContext + contextSection + existingWorkSection;
  }

  getCategoryDescription(category: IdeaCategory): string {
    const descriptions: Record<IdeaCategory, string> = {
      feature: 'New features and capabilities that add value for users',
      'ux-ui': 'User interface and user experience improvements',
      dx: 'Developer experience and tooling improvements',
      growth: 'User acquisition, engagement, and retention',
      technical: 'Architecture, performance, and infrastructure',
      security: 'Security improvements and vulnerability fixes',
      performance: 'Performance optimization and speed improvements',
      accessibility: 'Accessibility features and inclusive design',
      analytics: 'Analytics, monitoring, and insights features',
    };
    return descriptions[category] || '';
  }
}
