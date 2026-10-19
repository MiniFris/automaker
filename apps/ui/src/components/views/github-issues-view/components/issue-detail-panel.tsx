import { translate, useUiLocale } from '@/lib/i18n';
import {
  Circle,
  CheckCircle2,
  X,
  Wand2,
  ExternalLink,
  CheckCircle,
  Clock,
  GitPullRequest,
  User,
  RefreshCw,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Plus,
  ArrowLeft,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';
import type { IssueDetailPanelProps } from '../types';
import { isValidationStale } from '../utils';
import { ModelOverrideTrigger } from '@/components/shared';
import { useIssueComments } from '../hooks';
import { CommentItem } from './comment-item';

export function IssueDetailPanel({
  issue,
  validatingIssues,
  cachedValidations,
  onValidateIssue,
  onViewCachedValidation,
  onOpenInGitHub,
  onClose,
  onShowRevalidateConfirm,
  onCreateFeature,
  formatDate,
  modelOverride,
  isMobile = false,
}: IssueDetailPanelProps) {
  useUiLocale();
  const isValidating = validatingIssues.has(issue.number);
  const cached = cachedValidations.get(issue.number);
  const isStale = cached ? isValidationStale(cached.validatedAt) : false;

  // Comments state
  const [commentsExpanded, setCommentsExpanded] = useState(true);
  const [includeCommentsInAnalysis, setIncludeCommentsInAnalysis] = useState(true);
  const {
    comments,
    totalCount,
    loading: commentsLoading,
    loadingMore,
    hasNextPage,
    error: commentsError,
    loadMore,
  } = useIssueComments(issue.number);

  // Helper to get validation options with comments and linked PRs
  const getValidationOptions = (forceRevalidate = false) => {
    return {
      forceRevalidate,
      modelEntry: modelOverride.effectiveModelEntry, // Pass the full PhaseModelEntry to preserve thinking level
      comments: includeCommentsInAnalysis && comments.length > 0 ? comments : undefined,
      linkedPRs: issue.linkedPRs?.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
      })),
    };
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Detail Header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isMobile && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="shrink-0 -ml-1"
              aria-label={translate('Back')}
              title={translate('Back')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          {issue.state === 'OPEN' ? (
            <Circle className="h-4 w-4 text-green-500 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-purple-500 shrink-0" />
          )}
          <span className="text-sm font-medium truncate">
            #{issue.number} {issue.title}
          </span>
        </div>
        <div className={cn('flex items-center gap-2 shrink-0', isMobile && 'gap-1')}>
          {(() => {
            if (isValidating) {
              return (
                <Button variant="default" size="sm" loading>
                  {isMobile ? '...' : translate('Validating...')}
                </Button>
              );
            }

            if (cached && !isStale) {
              return (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewCachedValidation(issue)}
                    aria-label={translate('View Result')}
                    title={translate('View Result')}
                  >
                    <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
                    {!isMobile && translate('View Result')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onShowRevalidateConfirm(getValidationOptions(true))}
                    title={translate('Re-validate')}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </>
              );
            }

            if (cached && isStale) {
              return (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewCachedValidation(issue)}
                    aria-label={translate('View (stale)')}
                    title={translate('View (stale)')}
                  >
                    <Clock className="h-4 w-4 mr-1 text-yellow-500" />
                    {!isMobile && translate('View (stale)')}
                  </Button>
                  <ModelOverrideTrigger
                    currentModelEntry={modelOverride.effectiveModelEntry}
                    onModelChange={modelOverride.setOverride}
                    phase="validationModel"
                    isOverridden={modelOverride.isOverridden}
                    size="sm"
                    variant="icon"
                    className="mx-1"
                  />
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onValidateIssue(issue, getValidationOptions(true))}
                    aria-label={translate('Re-validate')}
                    title={translate('Re-validate')}
                  >
                    <Wand2 className="h-4 w-4 mr-1" />
                    {!isMobile && translate('Re-validate')}
                  </Button>
                </>
              );
            }

            return (
              <>
                <ModelOverrideTrigger
                  currentModelEntry={modelOverride.effectiveModelEntry}
                  onModelChange={modelOverride.setOverride}
                  phase="validationModel"
                  isOverridden={modelOverride.isOverridden}
                  size="sm"
                  variant="icon"
                  className="mr-1"
                />
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onValidateIssue(issue, getValidationOptions())}
                  aria-label={translate('Validate with AI')}
                  title={translate('Validate with AI')}
                >
                  <Wand2 className="h-4 w-4 mr-1" />
                  {!isMobile && translate('Validate with AI')}
                </Button>
              </>
            );
          })()}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onCreateFeature(issue)}
            aria-label={translate('Create Feature')}
            title={translate('Create a new feature to address this issue')}
          >
            <Plus className={cn('h-4 w-4', !isMobile && 'mr-1')} />
            {!isMobile && translate('Create Feature')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenInGitHub(issue.url)}
            aria-label={translate('Open in GitHub')}
            title={translate('Open in GitHub')}
          >
            <ExternalLink className="h-4 w-4" />
            {!isMobile && <span className="ml-1">{translate('Open in GitHub')}</span>}
          </Button>
          {!isMobile && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Issue Detail Content */}
      <div className={cn('flex-1 overflow-auto', isMobile ? 'p-4' : 'p-6')}>
        {/* Title */}
        <h1 className="text-xl font-bold mb-2">{issue.title}</h1>

        {/* Meta info */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-xs font-medium',
              issue.state === 'OPEN'
                ? 'bg-green-500/10 text-green-500'
                : 'bg-purple-500/10 text-purple-500'
            )}
          >
            {issue.state === 'OPEN' ? translate('Open') : translate('Closed')}
          </span>
          <span>
            #{issue.number} {translate(' opened ')}
            {formatDate(issue.createdAt)} {translate(' by')}{' '}
            <span className="font-medium text-foreground">{issue.author.login}</span>
          </span>
        </div>

        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {issue.labels.map((label) => (
              <span
                key={label.name}
                className="px-2 py-0.5 text-xs font-medium rounded-full"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                  border: `1px solid #${label.color}40`,
                }}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}

        {/* Assignees */}
        {issue.assignees && issue.assignees.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{translate('Assigned to:')}</span>
            <div className="flex items-center gap-2">
              {issue.assignees.map((assignee) => (
                <span
                  key={assignee.login}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20"
                >
                  {assignee.avatarUrl && (
                    <img
                      src={assignee.avatarUrl}
                      alt={assignee.login}
                      className="h-4 w-4 rounded-full"
                    />
                  )}
                  {assignee.login}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Linked Pull Requests */}
        {issue.linkedPRs && issue.linkedPRs.length > 0 && (
          <div className="mb-6 p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2 mb-2">
              <GitPullRequest className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium">{translate('Linked Pull Requests')}</span>
            </div>
            <div className="space-y-2">
              {issue.linkedPRs.map((pr) => (
                <div key={pr.number} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        'px-1.5 py-0.5 text-xs font-medium rounded',
                        pr.state === 'open'
                          ? 'bg-green-500/10 text-green-500'
                          : pr.state === 'merged'
                            ? 'bg-purple-500/10 text-purple-500'
                            : 'bg-red-500/10 text-red-500'
                      )}
                    >
                      {pr.state === 'open'
                        ? translate('Open')
                        : pr.state === 'merged'
                          ? translate('Merged')
                          : translate('Closed')}
                    </span>
                    <span className="text-muted-foreground">#{pr.number}</span>
                    <span className="truncate">{pr.title}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 shrink-0"
                    onClick={() => onOpenInGitHub(pr.url)}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        {issue.body ? (
          <Markdown className="text-sm">{issue.body}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {translate('No description provided.')}
          </p>
        )}

        {/* Comments Section */}
        <div className="mt-6 p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-2 text-left"
              onClick={() => setCommentsExpanded(!commentsExpanded)}
            >
              <MessageSquare className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">
                {translate('Comments ')}
                {totalCount > 0 && `(${totalCount})`}
              </span>
              {commentsLoading && <Spinner size="xs" />}
              {commentsExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {comments.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={includeCommentsInAnalysis}
                  onCheckedChange={setIncludeCommentsInAnalysis}
                />
                {translate('Include in AI analysis')}
              </label>
            )}
          </div>

          {commentsExpanded && (
            <div className="mt-3">
              {commentsError ? (
                <p className="text-sm text-red-500">{commentsError}</p>
              ) : comments.length === 0 && !commentsLoading ? (
                <p className="text-sm text-muted-foreground italic">
                  {translate('No comments yet.')}
                </p>
              ) : (
                <div className="space-y-3">
                  {comments.map((comment) => (
                    <CommentItem key={comment.id} comment={comment} />
                  ))}

                  {/* Load More Button */}
                  {hasNextPage && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={loadMore}
                      loading={loadingMore}
                    >
                      {loadingMore ? translate('Loading...') : translate('Load More Comments')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Create Feature CTA */}
        {isMobile && (
          <div className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center gap-2 mb-2">
              <Plus className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{translate('Create Feature')}</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {translate('Create a new feature task to address this issue.')}
            </p>
            <Button variant="secondary" onClick={() => onCreateFeature(issue)}>
              <Plus className="h-4 w-4 mr-2" />
              {translate('Create Feature')}
            </Button>
          </div>
        )}

        {/* Open in GitHub CTA */}
        <div className="mt-4 p-4 rounded-lg bg-muted/50 border border-border">
          <p className="text-sm text-muted-foreground mb-3">
            {translate('View comments, add reactions, and more on GitHub.')}
          </p>
          <Button onClick={() => onOpenInGitHub(issue.url)}>
            <ExternalLink className="h-4 w-4 mr-2" />
            {translate('View Full Issue on GitHub')}
          </Button>
        </div>
      </div>
    </div>
  );
}
