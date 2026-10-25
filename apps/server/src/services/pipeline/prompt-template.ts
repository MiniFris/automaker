import type { PipelineStep } from '@automaker/types';

/** Pure prompt expansion. Configuration validation belongs to the pipeline repository/schema boundary. */
export function buildPipelineStepPrompt(
  step: Pick<PipelineStep, 'name' | 'instructions'>,
  featureContext: string,
  previousContext: string
): string {
  let prompt = `## Pipeline Step: ${step.name}\n\nThis is an automated pipeline step.\n\n### Feature Context\n${featureContext}\n\n`;
  if (previousContext) prompt += `### Previous Work\n${previousContext}\n\n`;
  return (
    prompt +
    `### Pipeline Step Instructions\n${step.instructions}\n\n### Task\nComplete the pipeline step instructions above.\n\n` +
    `**CRITICAL: After completing the instructions, you MUST output a summary using this EXACT format:**\n\n` +
    `<summary>\n` +
    `## Summary: ${step.name}\n\n` +
    `### Changes Implemented\n` +
    `- [List all changes made in this step]\n\n` +
    `### Files Modified\n` +
    `- [List all files modified in this step]\n\n` +
    `### Outcome\n` +
    `- [Describe the result of this step]\n` +
    `</summary>\n\n` +
    `The <summary> and </summary> tags MUST be on their own lines. This is REQUIRED.`
  );
}
