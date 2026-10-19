import { useUiLocale } from '@/lib/i18n';
import { createLazyFileRoute, useSearch } from '@tanstack/react-router';
import { BoardView } from '@/components/views/board-view';

export const Route = createLazyFileRoute('/board')({
  component: BoardRouteComponent,
});

function BoardRouteComponent() {
  useUiLocale();
  const { featureId, projectPath } = useSearch({ from: '/board' });
  return <BoardView initialFeatureId={featureId} initialProjectPath={projectPath} />;
}
