'use client'

import React, { useState, useEffect, memo } from 'react'
import { SourceListResponse } from '@/lib/types/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import {
  FileText,
  ExternalLink,
  Upload,
  MoreVertical,
  Trash2,
  RefreshCw,
  Clock,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Unlink
} from 'lucide-react'
import { useSourceStatus } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { TFunction } from 'i18next'
import { cn } from '@/lib/utils'
import { ContextToggle } from '@/components/common/ContextToggle'
import { ContextMode } from '@/app/(dashboard)/notebooks/[id]/page'

interface SourceCardProps {
  source: SourceListResponse
  onDelete?: (sourceId: string) => void
  onRetry?: (sourceId: string) => void
  onRefreshContent?: (sourceId: string) => void
  onRemoveFromNotebook?: (sourceId: string) => void
  onClick?: (sourceId: string) => void
  onRefresh?: () => void
  className?: string
  showRemoveFromNotebook?: boolean
  contextMode?: ContextMode
  onContextModeChange?: (mode: ContextMode) => void
}

const SOURCE_TYPE_ICONS = {
  link: ExternalLink,
  upload: Upload,
  text: FileText,
} as const

const getStatusConfig = (t: TFunction) => ({
  new: {
    icon: Clock,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    label: t('sources.statusProcessing'),
    description: t('sources.statusPreparingDesc')
  },
  queued: {
    icon: Clock,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    label: t('sources.statusQueued'),
    description: t('sources.statusQueuedDesc')
  },
  running: {
    icon: Loader2,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    label: t('sources.statusProcessing'),
    description: t('sources.statusProcessingDesc')
  },
  completed: {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    label: t('sources.statusCompleted'),
    description: t('sources.statusCompletedDesc')
  },
  failed: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    label: t('sources.statusFailed'),
    description: t('sources.statusFailedDesc')
  }
} as const)

type SourceStatus = 'new' | 'queued' | 'running' | 'completed' | 'failed'

function isSourceStatus(status: unknown): status is SourceStatus {
  return typeof status === 'string' && ['new', 'queued', 'running', 'completed', 'failed'].includes(status)
}

function getSourceType(source: SourceListResponse): 'link' | 'upload' | 'text' {
  // Determine type based on asset information
  if (source.asset?.url) return 'link'
  if (source.asset?.file_path) return 'upload'
  return 'text'
}

function SourceCardImpl({
  source,
  onClick,
  onDelete,
  onRetry,
  onRefreshContent,
  onRemoveFromNotebook,
  onRefresh,
  className,
  showRemoveFromNotebook = false,
  contextMode,
  onContextModeChange
}: SourceCardProps) {
  const { t } = useTranslation()
  const statusConfigMap = getStatusConfig(t)
  
  // Only fetch status for sources that might have async processing
  const sourceWithStatus = source as SourceListResponse & { command_id?: string; status?: string }

  // Track processing state to continue polling until we detect completion
  const [wasProcessing, setWasProcessing] = useState(false)

  // Only poll status while the source is actually being processed (or just finished
  // and we still need one more poll to catch completion). The list endpoint already
  // populates `status` alongside `command_id`, so we no longer poll for every
  // completed source — that scaled linearly with the number of cards and caused the
  // list lag reported in #503.
  //
  // A source with a `command_id` but no resolved `status` yet is still ambiguous
  // (it renders as a synthetic "new"), so keep polling those until a real status
  // arrives — otherwise such a card would be stuck "processing" forever.
  const shouldFetchStatus =
    sourceWithStatus.status === 'new' ||
    sourceWithStatus.status === 'queued' ||
    sourceWithStatus.status === 'running' ||
    (!!sourceWithStatus.command_id && !sourceWithStatus.status) ||
    wasProcessing // Keep polling if we were processing to catch the completion

  const { data: statusData, isLoading: statusLoading } = useSourceStatus(
    source.id,
    shouldFetchStatus
  )

  // Determine current status
  // If source has a command_id but no status, treat as "new" (just created)
  const rawStatus = statusData?.status || sourceWithStatus.status
  const currentStatus: SourceStatus = isSourceStatus(rawStatus)
    ? rawStatus
    : (sourceWithStatus.command_id ? 'new' : 'completed')


  // Track processing state and detect completion
  useEffect(() => {
    const currentStatusFromData = statusData?.status || sourceWithStatus.status

    // If we're currently processing, mark that we were processing
    if (currentStatusFromData === 'new' || currentStatusFromData === 'running' || currentStatusFromData === 'queued') {
      setWasProcessing(true)
    }

    // If we were processing and now completed/failed, trigger refresh and stop polling
    if (wasProcessing &&
        (currentStatusFromData === 'completed' || currentStatusFromData === 'failed')) {
      setWasProcessing(false) // Stop polling

      if (onRefresh) {
        setTimeout(() => onRefresh(), 500) // Small delay to ensure API is updated
      }
    }
  }, [statusData, sourceWithStatus.status, wasProcessing, onRefresh, source.id])
  
  const statusConfig = statusConfigMap[currentStatus] || statusConfigMap.completed
  const StatusIcon = statusConfig.icon
  const sourceType = getSourceType(source)
  const SourceTypeIcon = SOURCE_TYPE_ICONS[sourceType]
  
   const title = source.title || t('sources.untitledSource')

  const handleRetry = () => {
    if (onRetry) {
      onRetry(source.id)
    }
  }

  const handleRefreshContent = () => {
    if (onRefreshContent) {
      onRefreshContent(source.id)
    }
  }

  const handleDelete = () => {
    if (onDelete) {
      onDelete(source.id)
    }
  }

  const handleRemoveFromNotebook = () => {
    if (onRemoveFromNotebook) {
      onRemoveFromNotebook(source.id)
    }
  }

  const handleCardClick = () => {
    if (onClick) {
      onClick(source.id)
    }
  }

  const isProcessing: boolean = currentStatus === 'new' || currentStatus === 'running' || currentStatus === 'queued'
  const isFailed: boolean = currentStatus === 'failed'
  const isCompleted: boolean = currentStatus === 'completed'

  const isChecked = contextMode !== 'off'
  const handleCheckboxChange = (checked: boolean) => {
    if (onContextModeChange) {
      onContextModeChange(checked ? (source.insights_count > 0 ? 'insights' : 'full') : 'off')
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-2 rounded-lg border border-border/60 dark:border-border/40 hover:bg-muted/50 transition-colors group cursor-pointer relative',
        className
      )}
      onClick={handleCardClick}
    >
      {/* Checkbox */}
      {onContextModeChange && (
        <div onClick={(e) => e.stopPropagation()} className="flex items-center">
          <Checkbox
            checked={isChecked}
            onCheckedChange={handleCheckboxChange}
            aria-label={title}
          />
        </div>
      )}

      {/* Main Info */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {/* Type Icon */}
        <SourceTypeIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h4
              className="text-sm font-medium leading-tight truncate"
              title={title}
            >
              {title}
            </h4>
            
            {/* Status indicator */}
            {!isCompleted && (
              <span className={cn('text-xs flex items-center gap-1 font-medium', statusConfig.color)}>
                <StatusIcon className={cn('h-3.5 w-3.5', isProcessing && 'animate-spin')} />
              </span>
            )}
          </div>
          
          {/* Topics or summary details in very small font */}
          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
            {source.insights_count > 0 && (
              <span>{source.insights_count} insights</span>
            )}
            {source.topics && source.topics.length > 0 && (
              <>
                {source.insights_count > 0 && <span>•</span>}
                <span className="truncate">{source.topics.slice(0, 2).join(', ')}</span>
              </>
            )}
            {isProcessing && typeof statusData?.processing_info?.progress === 'number' && (
              <>
                <span>•</span>
                <span className="text-blue-600 font-medium">
                  {Math.round(statusData.processing_info.progress as number)}%
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions / Modes on the right */}
      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {/* Context cycle mode toggle */}
        {onContextModeChange && contextMode && (
          <ContextToggle
            mode={contextMode}
            hasInsights={source.insights_count > 0}
            onChange={onContextModeChange}
          />
        )}

        {/* Dropdown Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {showRemoveFromNotebook && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemoveFromNotebook()
                  }}
                  disabled={!onRemoveFromNotebook}
                >
                  <Unlink className="h-4 w-4 mr-2" />
                  {t('sources.removeFromNotebook')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isFailed && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRetry()
                  }}
                  disabled={!onRetry}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('sources.retryProcessing')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {sourceType === 'link' && isCompleted && onRefreshContent && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRefreshContent()
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('sources.refreshContent')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                handleDelete()
              }}
              disabled={!onDelete}
              className="text-red-600 focus:text-red-600"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('sources.deleteSource')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/**
 * SourceCard is rendered in long lists (one per source). Without memoization, any
 * parent re-render (layout toggles, context-selection changes elsewhere) re-rendered
 * every card, causing UI jank that scaled with the number of sources (#503).
 *
 * We compare only the props that affect this card's rendered output. Handler identity
 * is intentionally ignored: callers often pass inline closures, and those closures
 * capture the source id, so a stale closure stays correct as long as the source data
 * below is unchanged.
 */
function topicsEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false
  if (!a || !b) return true // both empty/undefined (lengths matched above)
  return a.every((topic, i) => topic === b[i])
}

function areEqual(prev: SourceCardProps, next: SourceCardProps): boolean {
  if (prev === next) return true

  const p = prev.source as SourceListResponse & { command_id?: string; status?: string }
  const n = next.source as SourceListResponse & { command_id?: string; status?: string }

  return (
    p.id === n.id &&
    p.title === n.title &&
    p.updated === n.updated &&
    p.status === n.status &&
    p.command_id === n.command_id &&
    p.embedded === n.embedded &&
    p.insights_count === n.insights_count &&
    p.asset?.url === n.asset?.url &&
    p.asset?.file_path === n.asset?.file_path &&
    topicsEqual(p.topics, n.topics) &&
    prev.contextMode === next.contextMode &&
    prev.showRemoveFromNotebook === next.showRemoveFromNotebook &&
    prev.className === next.className
  )
}

export const SourceCard = memo(SourceCardImpl, areEqual)
