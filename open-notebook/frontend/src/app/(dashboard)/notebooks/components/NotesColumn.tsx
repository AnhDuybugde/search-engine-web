'use client'

import { useState, useMemo } from 'react'
import { NoteResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, StickyNote, Bot, User, MoreVertical, Trash2, ListChecks, ChevronDown, Database, Cpu, Activity, BarChart3 } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { NoteEditorDialog } from './NoteEditorDialog'
import { getDateLocale } from '@/lib/utils/date-locale'
import { formatDistanceToNow } from 'date-fns'
import { ContextToggle } from '@/components/common/ContextToggle'
import type { NoteContextMode } from '../[id]/page'
import type { NoteContextDefault } from '@/lib/utils/source-context'
import { useDeleteNote } from '@/lib/hooks/use-notes'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { CollapsibleColumn, createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { useModalManager } from '@/lib/hooks/use-modal-manager'

interface NotesColumnProps {
  notes?: NoteResponse[]
  isLoading: boolean
  notebookId: string
  contextSelections?: Record<string, NoteContextMode>
  onContextModeChange?: (noteId: string, mode: NoteContextMode) => void
  onBulkContextModeChange?: (action: NoteContextDefault) => void
  lastContext?: any
  tokenCount?: number
  charCount?: number
}

export function NotesColumn({
  notes,
  isLoading,
  notebookId,
  contextSelections,
  onContextModeChange,
  onBulkContextModeChange,
  lastContext,
  tokenCount = 0,
  charCount = 0
}: NotesColumnProps) {
  const { t, language } = useTranslation()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteResponse | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'notes' | 'evidence' | 'metrics'>('notes')

  const { openModal } = useModalManager()
  const deleteNote = useDeleteNote()

  // Collapsible column state
  const { notesCollapsed, toggleNotes } = useNotebookColumnsStore()
  const studioLabel = t('navigation.studio', 'Studio')
  const collapseButton = useMemo(
    () => createCollapseButton(toggleNotes, studioLabel),
    [toggleNotes, studioLabel]
  )

  const handleDeleteClick = (noteId: string) => {
    setNoteToDelete(noteId)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!noteToDelete) return

    try {
      await deleteNote.mutateAsync(noteToDelete)
      setDeleteDialogOpen(false)
      setNoteToDelete(null)
    } catch (error) {
      console.error('Failed to delete note:', error)
    }
  }

  return (
    <>
      <CollapsibleColumn
        isCollapsed={notesCollapsed}
        onToggle={toggleNotes}
        collapsedIcon={StickyNote}
        collapsedLabel={studioLabel}
      >
        <Card className="h-full flex flex-col flex-1 overflow-hidden">
          <CardHeader className="pb-2 flex-shrink-0 border-b">
            <div className="flex items-center justify-between gap-2 mb-2">
              <CardTitle className="text-lg">{studioLabel}</CardTitle>
              <div className="flex items-center gap-2">
                {collapseButton}
              </div>
            </div>
            
            {/* Tabs List */}
            <Tabs value={activeTab} onValueChange={(val: any) => setActiveTab(val)} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="notes" className="text-xs gap-1.5">
                  <StickyNote className="h-3.5 w-3.5" />
                  {t('common.notes')}
                </TabsTrigger>
                <TabsTrigger value="evidence" className="text-xs gap-1.5">
                  <Database className="h-3.5 w-3.5" />
                  Evidence
                </TabsTrigger>
                <TabsTrigger value="metrics" className="text-xs gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  Metrics
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>

          <Tabs value={activeTab} onValueChange={(val: any) => setActiveTab(val)} className="flex-1 flex flex-col min-h-0">
            {/* Notes Content */}
            <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 m-0">
              <div className="p-3 flex items-center justify-between border-b bg-muted/10 gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground font-medium">Manage Notes</span>
                <div className="flex items-center gap-2">
                  {onBulkContextModeChange && notes && notes.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 px-2" title={t('sources.bulkContext')}>
                          <ListChecks className="h-4 w-4" />
                          <ChevronDown className="h-4 w-4 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onBulkContextModeChange('include')}>
                          {t('sources.includeAllInContext')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onBulkContextModeChange('exclude')}>
                          {t('sources.excludeAllFromContext')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setEditingNote(null)
                      setShowAddDialog(true)
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t('common.writeNote')}
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 p-4">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner />
                  </div>
                ) : !notes || notes.length === 0 ? (
                  <EmptyState
                    icon={StickyNote}
                    title={t('notebooks.noNotesYet')}
                    description={t('sources.createFirstNote')}
                  />
                ) : (
                  <div className="space-y-3">
                    {notes.map((note) => (
                      <div
                        key={note.id}
                        className="p-3 border rounded-lg card-hover group relative cursor-pointer"
                        onClick={() => setEditingNote(note)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {note.note_type === 'ai' ? (
                              <Bot className="h-4 w-4 text-primary" />
                            ) : (
                              <User className="h-4 w-4 text-muted-foreground" />
                            )}
                            <Badge variant="secondary" className="text-xs">
                              {note.note_type === 'ai' ? t('common.aiGenerated') : t('common.human')}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(note.updated), { 
                                addSuffix: true,
                                locale: getDateLocale(language)
                              })}
                            </span>

                            {/* Context toggle */}
                            {onContextModeChange && contextSelections?.[note.id] && (
                              <div onClick={(event) => event.stopPropagation()}>
                                <ContextToggle
                                  mode={contextSelections[note.id]}
                                  hasInsights={false}
                                  onChange={(mode) => onContextModeChange(note.id, mode)}
                                />
                              </div>
                            )}

                            {/* Ellipsis menu */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteClick(note.id)
                                  }}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  {t('notebooks.deleteNote')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        {note.title && (
                          <h4 className="text-sm font-medium mb-2 break-all">{note.title}</h4>
                        )}

                        {note.content && (
                          <p className="text-sm text-muted-foreground line-clamp-3 break-all">
                            {note.content}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Evidence Content */}
            <TabsContent value="evidence" className="flex-1 overflow-y-auto min-h-0 p-4 m-0">
              {!lastContext || (!lastContext.sources?.length && !lastContext.notes?.length) ? (
                <EmptyState
                  icon={Database}
                  title="No Evidence Retrieved"
                  description="No sources or notes are currently selected as context. Add items to your context from the left panel."
                />
              ) : (
                <div className="space-y-4">
                  {lastContext.sources?.map((src: any, idx: number) => (
                    <div
                      key={`src-ev-${idx}`}
                      className="p-3 border rounded-lg hover:bg-muted/30 transition-colors cursor-pointer group space-y-2"
                      onClick={() => openModal('source', src.source_id || src.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-primary truncate max-w-[70%]">
                          {src.title || 'Untitled Source'}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                          Chunk {idx + 1}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-4 leading-relaxed font-mono bg-muted/20 p-2 rounded">
                        {src.text || src.content}
                      </p>
                    </div>
                  ))}

                  {lastContext.notes?.map((note: any, idx: number) => (
                    <div
                      key={`note-ev-${idx}`}
                      className="p-3 border rounded-lg hover:bg-muted/30 transition-colors cursor-pointer group space-y-2"
                      onClick={() => openModal('note', note.note_id || note.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-amber-600 truncate max-w-[70%]">
                          {note.title || 'Untitled Note'}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                          Note Context
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-4 leading-relaxed font-mono bg-muted/20 p-2 rounded">
                        {note.text || note.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Metrics Content */}
            <TabsContent value="metrics" className="flex-1 overflow-y-auto min-h-0 p-4 m-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Card className="bg-muted/20 border-muted">
                  <CardContent className="p-3 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-primary">{tokenCount.toLocaleString()}</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Total Tokens</span>
                  </CardContent>
                </Card>
                <Card className="bg-muted/20 border-muted">
                  <CardContent className="p-3 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-primary">{charCount.toLocaleString()}</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Total Characters</span>
                  </CardContent>
                </Card>
              </div>

              {/* Progress bar showing capacity */}
              <div className="space-y-1.5 p-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Context Utilization</span>
                  <span>{Math.round((tokenCount / 32768) * 100)}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.round((tokenCount / 32768) * 100))}%` }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground text-right">
                  Capacity: 32,768 tokens (Ollama Context)
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Breakdown</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Retrieved Chunks</span>
                    <span className="font-medium">{lastContext?.sources?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Retrieved Notes</span>
                    <span className="font-medium">{lastContext?.notes?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Avg. Tokens per Chunk</span>
                    <span className="font-medium">
                      {lastContext?.sources?.length
                        ? Math.round(tokenCount / lastContext.sources.length)
                        : 0}
                    </span>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Card>
      </CollapsibleColumn>

      <NoteEditorDialog
        open={showAddDialog || Boolean(editingNote)}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddDialog(false)
            setEditingNote(null)
          } else {
            setShowAddDialog(true)
          }
        }}
        notebookId={notebookId}
        note={editingNote ?? undefined}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('notebooks.deleteNote')}
        description={t('notebooks.deleteNoteConfirm')}
        confirmText={t('common.delete')}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteNote.isPending}
        confirmVariant="destructive"
      />
    </>
  )
}
