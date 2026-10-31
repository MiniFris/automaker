import { DEFAULT_FEATURE_TEMPLATES, type FeatureTemplate } from '@automaker/types';
import { translate } from './i18n';

function builtInText(id: string): Pick<FeatureTemplate, 'name' | 'prompt'> | undefined {
  switch (id) {
    case 'run-tests-lint-format':
      return {
        name: translate('Run tests, lint, and format'),
        prompt: translate(
          'Run all tests, lint checks, and format the codebase. Fix any issues found. Ensure the code passes all quality checks before marking complete.'
        ),
      };
    case 'write-tests-for-changes':
      return {
        name: translate('Write tests for current changes'),
        prompt: translate(
          'Analyze the current uncommitted changes and write comprehensive tests for the modified code. Focus on edge cases and ensure good test coverage.'
        ),
      };
    case 'review-recent-changes':
      return {
        name: translate('Review and summarize recent changes'),
        prompt: translate(
          'Review the recent commits and changes in this codebase. Provide a summary of what was changed, identify any potential issues, and suggest improvements.'
        ),
      };
    case 'fix-lint-errors':
      return {
        name: translate('Fix lint errors'),
        prompt: translate(
          'Run the linter and fix all reported errors. Ensure the codebase passes lint checks without warnings.'
        ),
      };
    case 'update-dependencies':
      return {
        name: translate('Update and test dependencies'),
        prompt: translate(
          'Check for outdated dependencies, update them to their latest stable versions, and run tests to ensure nothing breaks. Document any breaking changes or migration steps required.'
        ),
      };
    case 'code-review-and-fix':
      return {
        name: translate('Code review and fix issues'),
        prompt: translate(
          'Perform a thorough code review of the current codebase. Identify and fix any issues found, including: code quality problems, potential bugs, security vulnerabilities, performance bottlenecks, and violations of best practices. After fixing all issues, run tests and lint to verify everything passes.'
        ),
      };
  }
}

/** Localize application-owned defaults only; edited and custom text remains user content. */
export function localizeFeatureTemplate(template: FeatureTemplate): FeatureTemplate {
  if (!template.isBuiltIn) return template;
  const original = DEFAULT_FEATURE_TEMPLATES.find((item) => item.id === template.id);
  const localized = original && builtInText(template.id);
  if (!original || !localized) return template;
  return {
    ...template,
    name: template.name === original.name ? localized.name : template.name,
    prompt: template.prompt === original.prompt ? localized.prompt : template.prompt,
  };
}
