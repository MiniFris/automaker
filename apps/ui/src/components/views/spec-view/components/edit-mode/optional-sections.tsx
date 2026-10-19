import { translate, useUiLocale } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollText, Wrench } from 'lucide-react';
import { ArrayFieldEditor } from './array-field-editor';

interface RequirementsSectionProps {
  requirements: string[];
  onChange: (requirements: string[]) => void;
}

export function RequirementsSection({ requirements, onChange }: RequirementsSectionProps) {
  useUiLocale();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ScrollText className="w-5 h-5 text-primary" />
          {translate('Additional Requirements')}
          <span className="text-sm font-normal text-muted-foreground">
            {translate('(Optional)')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ArrayFieldEditor
          values={requirements}
          onChange={onChange}
          placeholder={translate('e.g., Node.js >= 18, Docker required...')}
          addLabel="Add Requirement"
          emptyMessage={translate('No additional requirements specified.')}
        />
      </CardContent>
    </Card>
  );
}

interface GuidelinesSectionProps {
  guidelines: string[];
  onChange: (guidelines: string[]) => void;
}

export function GuidelinesSection({ guidelines, onChange }: GuidelinesSectionProps) {
  useUiLocale();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wrench className="w-5 h-5 text-primary" />
          {translate('Development Guidelines')}
          <span className="text-sm font-normal text-muted-foreground">
            {translate('(Optional)')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ArrayFieldEditor
          values={guidelines}
          onChange={onChange}
          placeholder={translate('e.g., Follow TypeScript strict mode, use ESLint...')}
          addLabel="Add Guideline"
          emptyMessage={translate('No development guidelines specified.')}
        />
      </CardContent>
    </Card>
  );
}
