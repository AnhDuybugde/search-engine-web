'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/hooks/use-translation'
import { AppShell } from '@/components/layout/AppShell'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { 
  Search, 
  ChevronDown, 
  AlertCircle, 
  Settings, 
  Save, 
  MessageCircleQuestion, 
  Globe, 
  BookOpen, 
  Database,
  Sparkles,
  Terminal,
  Activity,
  Download,
  X,
  Play,
  Check,
  Loader2,
  Clock,
  FileText,
  ExternalLink,
  History,
  Trash2,
  RefreshCw
} from 'lucide-react'
import { useSearch } from '@/lib/hooks/use-search'
import { useAsk } from '@/lib/hooks/use-ask'
import { useModelDefaults, useModels } from '@/lib/hooks/use-models'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { useSources } from '@/lib/hooks/use-sources'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { StreamingResponse } from '@/components/search/StreamingResponse'
import { AdvancedModelsDialog } from '@/components/search/AdvancedModelsDialog'
import { SaveToNotebooksDialog } from '@/components/search/SaveToNotebooksDialog'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import apiClient from '@/lib/api/client'
import { toast } from 'sonner'

export default function SearchPage() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const urlQuery = searchParams?.get('q') || ''
  const rawMode = searchParams?.get('mode')
  
  // Tabs: 'web_search' | 'notebook_search' | 'local_search'
  const [activeTab, setActiveTab] = useState<'web_search' | 'notebook_search' | 'local_search'>('web_search')

  // --- Web Search State ---
  const [webQuery, setWebQuery] = useState('')
  const [searchLimit, setSearchLimit] = useState(20)
  const [retrieveTopK, setRetrieveTopK] = useState(40)
  const [rerankTopK, setRerankTopK] = useState(10)
  const [contextTopK, setContextTopK] = useState(6)
  const [generateAnswer, setGenerateAnswer] = useState(true)
  const [showWebOptions, setShowWebOptions] = useState(false)

  // SSE Stream State
  const [runId, setRunId] = useState<string | null>(null)
  const [webStatus, setWebStatus] = useState<'idle' | 'running' | 'completed' | 'failed' | 'cancelled'>('idle')
  const [liveLogs, setLiveLogs] = useState<string[]>([])
  const [answerText, setAnswerText] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [timing, setTiming] = useState<Record<string, number> | null>(null)
  const [metrics, setMetrics] = useState<Record<string, any> | null>(null)
  const [webError, setWebError] = useState<string | null>(null)
  const [highlightedChunkIndex, setHighlightedChunkIndex] = useState<number | null>(null)

  // Steps indicator status
  const [stepsStatus, setStepsStatus] = useState<Record<string, 'pending' | 'running' | 'success' | 'failed'>>({
    search: 'pending',
    fetch: 'pending',
    chunk: 'pending',
    retrieve: 'pending',
    rerank: 'pending',
    generate: 'pending',
  })

  // History Sidebar
  const [showHistory, setShowHistory] = useState(false)
  const [pastRuns, setPastRuns] = useState<any[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  // --- Notebook Search State ---
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>('')
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [notebookQuery, setNotebookQuery] = useState('')
  const [notebookLimit, setNotebookLimit] = useState(6)
  const [notebookGenerateAnswer, setNotebookGenerateAnswer] = useState(true)
  const [notebookAnswer, setNotebookAnswer] = useState('')
  const [notebookResults, setNotebookResults] = useState<any[]>([])
  const [notebookStatus, setNotebookStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [notebookError, setNotebookError] = useState<string | null>(null)

  // --- Knowledge Base (Original Ask/Search) State ---
  const [kbQuery, setKbQuery] = useState('')
  const [kbSearchType, setKbSearchType] = useState<'text' | 'vector'>('text')
  const [kbSearchSources, setKbSearchSources] = useState(true)
  const [kbSearchNotes, setKbSearchNotes] = useState(true)
  const [kbAskQuestion, setKbAskQuestion] = useState('')
  const [showAdvancedModels, setShowAdvancedModels] = useState(false)
  const [customModels, setCustomModels] = useState<{
    strategy: string
    answer: string
    finalAnswer: string
  } | null>(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [kbActiveSubTab, setKbActiveSubTab] = useState<'ask' | 'search'>('ask')

  // --- Hooks & API Queries ---
  const { data: notebooks } = useNotebooks()
  const { data: notebookSources, isLoading: isLoadingSources } = useSources(selectedNotebookId)
  const kbSearchMutation = useSearch()
  const kbAsk = useAsk()
  const { data: modelDefaults, isLoading: modelsLoading } = useModelDefaults()
  const { data: availableModels } = useModels()
  const { openModal } = useModalManager()

  const modelNameById = useMemo(() => {
    if (!availableModels) return new Map<string, string>()
    return new Map(availableModels.map((model) => [model.id, model.name]))
  }, [availableModels])

  const resolveModelName = (id?: string | null) => {
    if (!id) return t('searchPage.notSet', 'Not Set')
    return modelNameById.get(id) ?? id
  }

  const hasEmbeddingModel = !!modelDefaults?.default_embedding_model
  const abortControllerRef = useRef<AbortController | null>(null)

  // --- Fetch Past Web Search Runs ---
  const fetchPastRuns = useCallback(async () => {
    setIsLoadingHistory(true)
    try {
      const response = await apiClient.get<any[]>('/search/runs')
      setPastRuns(response.data || [])
    } catch (e) {
      console.error('Failed to fetch past runs:', e)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [])

  // Auto load history
  useEffect(() => {
    fetchPastRuns()
  }, [fetchPastRuns])

  // --- Handle SSE Events ---
  const handleSSEEvent = useCallback((eventData: { event: string, data: any }) => {
    const { event, data } = eventData
    
    switch (event) {
      case 'search_started':
        setStepsStatus(prev => ({ ...prev, search: 'running' }))
        setLiveLogs(prev => [...prev, `🔍 Querying SearXNG Web Search Engine...`])
        break
        
      case 'search_results_received':
        setStepsStatus(prev => ({ ...prev, search: 'success', fetch: 'running' }))
        setLiveLogs(prev => [
          ...prev, 
          `✅ Found ${data.count} raw URLs from SearXNG search results.`,
          `🌐 Starting parallel page fetching and extraction...`
        ])
        break
        
      case 'fetch_started':
        setLiveLogs(prev => [...prev, `📦 Concurrent connection pools created for ${data.urls?.length || 0} unique domains.`])
        break
        
      case 'document_fetched':
        setLiveLogs(prev => [...prev, `📥 Successfully downloaded and cleaned page content: "${data.title}"`])
        break
        
      case 'document_failed':
        setLiveLogs(prev => [...prev, `⚠️ Skip page "${data.url}": ${data.error}`])
        break
        
      case 'chunking_completed':
        setStepsStatus(prev => ({ ...prev, fetch: 'success', chunk: 'success', retrieve: 'running' }))
        setLiveLogs(prev => [
          ...prev,
          `✅ Web extraction completed. Segmented texts into ${data.chunks_count} word chunks.`,
          `🧠 Instantiating BM25 vocabulary index...`
        ])
        break
        
      case 'bm25_completed':
        setStepsStatus(prev => ({ ...prev, retrieve: 'success', rerank: 'running' }))
        setLiveLogs(prev => [
          ...prev,
          `✅ BM25 completed: retrieved ${data.count} candidates matching term frequencies.`,
          `⚡ Executing bge-reranker-v2-m3 local cross-encoder model...`
        ])
        break
        
      case 'reranking_completed':
        setStepsStatus(prev => ({ ...prev, rerank: 'success', generate: 'running' }))
        setLiveLogs(prev => [
          ...prev,
          `✅ Cross-Encoder scoring finished. Filtered down to top ${data.count} most relevant passages.`,
        ])
        break
        
      case 'retrieval_ready':
        setResults(data.results || [])
        break
        
      case 'generation_started':
        setLiveLogs(prev => [...prev, `🤖 Submitting prompt with context chunks to Ollama generation pipeline...`])
        break
        
      case 'generation_token':
        setAnswerText(prev => prev + (data.token || ''))
        break
        
      case 'generation_completed':
        setStepsStatus(prev => ({ ...prev, generate: 'success' }))
        setLiveLogs(prev => [...prev, `✅ Research synthesis complete.`])
        break
        
      case 'run_completed':
        setWebStatus('completed')
        setTiming(data.run?.timing || null)
        setMetrics(data.run?.metrics || null)
        fetchPastRuns()
        break
        
      case 'run_failed':
        setWebStatus('failed')
        setWebError(data.error || 'Execution failed')
        setLiveLogs(prev => [...prev, `❌ Run failed: ${data.error}`])
        setStepsStatus(prev => {
          const next = { ...prev }
          Object.keys(next).forEach(k => {
            if (next[k as keyof typeof next] === 'running') {
              next[k as keyof typeof next] = 'failed'
            }
          })
          return next
        })
        break
        
      default:
        break
    }
  }, [fetchPastRuns])

  // --- Run Web Search SSE Stream ---
  const runWebSearchStream = async (targetRunId: string) => {
    let token = null
    if (typeof window !== 'undefined') {
      const authStorage = localStorage.getItem('auth-storage')
      if (authStorage) {
        try {
          const { state } = JSON.parse(authStorage)
          if (state?.token) {
            token = state.token
          }
        } catch (e) {
          console.error(e)
        }
      }
    }

    const url = `/api/search/runs/${targetRunId}/events`
    
    // Create new abort controller
    abortControllerRef.current = new AbortController()

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...(token && { Authorization: `Bearer ${token}` })
        },
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      if (!response.body) {
        throw new Error('No response body received')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim()
            if (!jsonStr) continue
            
            try {
              const eventData = JSON.parse(jsonStr)
              handleSSEEvent(eventData)
            } catch (err) {
              console.error('Error parsing JSON from stream line:', line, err)
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('SSE Stream aborted by user')
      } else {
        console.error('SSE Stream Error:', err)
        setWebStatus('failed')
        setWebError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  // --- Start Web Search Run ---
  const handleWebSearch = async () => {
    if (!webQuery.trim()) return

    // Reset Web State
    setWebStatus('running')
    setLiveLogs(['🚀 Initializing search run workspace...'])
    setAnswerText('')
    setResults([])
    setTiming(null)
    setMetrics(null)
    setWebError(null)
    setStepsStatus({
      search: 'pending',
      fetch: 'pending',
      chunk: 'pending',
      retrieve: 'pending',
      rerank: 'pending',
      generate: generateAnswer ? 'pending' : 'success',
    })

    try {
      // Create Run
      const response = await apiClient.post<any>('/search/runs', {
        query: webQuery,
        search_limit: searchLimit,
        retrieve_top_k: retrieveTopK,
        rerank_top_k: rerankTopK,
        context_top_k: contextTopK,
        generate_answer: generateAnswer
      })

      const run = response.data
      setRunId(run.id)

      // Start reading events
      await runWebSearchStream(run.id)
    } catch (e: any) {
      console.error('Failed to create search run:', e)
      setWebStatus('failed')
      setWebError(e.response?.data?.detail || e.message || 'Failed to create search run')
    }
  }

  // --- Cancel Web Search Run ---
  const handleCancelWebSearch = async () => {
    if (!runId) return
    
    // Abort active fetch reader
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    setWebStatus('cancelled')
    setLiveLogs(prev => [...prev, '🛑 Search run cancellation requested.'])

    try {
      await apiClient.post(`/search/runs/${runId}/cancel`)
      setLiveLogs(prev => [...prev, '✅ Search run successfully cancelled.'])
    } catch (e) {
      console.error('Failed to cancel search run:', e)
    }
  }

  // --- Restore Past Run Details ---
  const handleLoadPastRun = async (run: any) => {
    setRunId(run.id)
    setWebQuery(run.query)
    setWebStatus(run.status)
    setAnswerText(run.generated_answer || '')
    setResults(run.results || [])
    setTiming(run.timing || null)
    setMetrics(run.metrics || null)
    setWebError(run.error || null)
    
    const wasSuccess = run.status === 'completed'
    setStepsStatus({
      search: wasSuccess ? 'success' : 'failed',
      fetch: wasSuccess ? 'success' : 'failed',
      chunk: wasSuccess ? 'success' : 'failed',
      retrieve: wasSuccess ? 'success' : 'failed',
      rerank: wasSuccess ? 'success' : 'failed',
      generate: wasSuccess ? 'success' : 'failed',
    })
    setLiveLogs(['📜 Restored past search run records from database.'])
    setShowHistory(false)
  }

  // --- Delete Search Run ---
  const handleDeleteRun = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await apiClient.delete(`/search/runs/${id}`)
      toast.success('Run deleted successfully')
      fetchPastRuns()
      if (runId === id) {
        setRunId(null)
        setWebStatus('idle')
        setAnswerText('')
        setResults([])
        setTiming(null)
        setMetrics(null)
      }
    } catch (err) {
      toast.error('Failed to delete run')
    }
  }

  // --- Export Data Helpers ---
  const handleExportJSON = () => {
    if (!runId) return
    const exportObj = {
      run_id: runId,
      query: webQuery,
      status: webStatus,
      config: { searchLimit, retrieveTopK, rerankTopK, contextTopK, generateAnswer },
      timing,
      metrics,
      answer: answerText,
      results
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2))
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute("href", dataStr)
    downloadAnchor.setAttribute("download", `search-run-${runId}.json`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
  }

  const handleExportCSV = () => {
    if (!timing && !metrics) return
    let csvRows = []
    
    csvRows.push("Metric type,Name,Value")
    if (timing) {
      Object.entries(timing).forEach(([k, v]) => {
        csvRows.push(`Timing,${k},${v}`)
      })
    }
    if (metrics) {
      Object.entries(metrics).forEach(([k, v]) => {
        csvRows.push(`Quantity,${k},"${String(v).replace(/"/g, '""')}"`)
      })
    }

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n")
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute("href", csvContent)
    downloadAnchor.setAttribute("download", `search-run-metrics-${runId || 'export'}.csv`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
  }

  // --- Citation Scroll Handler ---
  const handleCitationClick = (index: number) => {
    const el = document.getElementById(`source-chunk-${index}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightedChunkIndex(index)
      setTimeout(() => {
        setHighlightedChunkIndex(null)
      }, 2500)
    }
  }

  // Markdown citation converter
  const formattedAnswer = useMemo(() => {
    return answerText.replace(/\[(\d+)\]/g, '[$1](#citation-$1)')
  }, [answerText])

  const customMarkdownComponents = useMemo(() => ({
    a: ({ href, children }: any) => {
      if (href?.startsWith('#citation-')) {
        const index = parseInt(href.replace('#citation-', ''), 10)
        return (
          <span 
            onClick={() => handleCitationClick(index)}
            className="inline-flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold px-1.5 py-0.5 rounded cursor-pointer select-none mx-0.5"
          >
            {children}
          </span>
        )
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{children}</a>
    }
  }), [])

  // Domain parser
  const getDomain = (url?: string) => {
    if (!url) return 'Local Chunk'
    try {
      const parsed = new URL(url)
      return parsed.hostname.replace('www.', '')
    } catch {
      return url
    }
  }

  // --- Notebook Search Handler ---
  const handleNotebookSearch = async () => {
    if (!selectedNotebookId || !notebookQuery.trim()) return
    
    setNotebookStatus('loading')
    setNotebookAnswer('')
    setNotebookResults([])
    setNotebookError(null)

    try {
      const response = await apiClient.post(`/notebooks/${selectedNotebookId}/answer`, {
        query: notebookQuery,
        source_ids: selectedSourceIds.length > 0 ? selectedSourceIds : null,
        limit: notebookLimit,
        generate_answer: notebookGenerateAnswer
      })

      setNotebookAnswer(response.data.answer || '')
      setNotebookResults(response.data.results || [])
      setNotebookStatus('success')
    } catch (err: any) {
      console.error(err)
      setNotebookStatus('error')
      setNotebookError(err.response?.data?.detail || err.message || 'Notebook retrieval query failed.')
    }
  }

  const handleToggleSourceId = (id: string) => {
    setSelectedSourceIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  // --- Knowledge Base (Original Search) Handlers ---
  const handleKbSearch = useCallback(() => {
    if (!kbQuery.trim()) return
    kbSearchMutation.mutate({
      query: kbQuery,
      type: kbSearchType,
      limit: 100,
      search_sources: kbSearchSources,
      search_notes: kbSearchNotes,
      minimum_score: 0.2
    })
  }, [kbQuery, kbSearchType, kbSearchSources, kbSearchNotes, kbSearchMutation])

  const handleKbAsk = useCallback(() => {
    if (!kbAskQuestion.trim() || !modelDefaults?.default_chat_model) return
    const models = customModels || {
      strategy: modelDefaults.default_chat_model,
      answer: modelDefaults.default_chat_model,
      finalAnswer: modelDefaults.default_chat_model
    }
    kbAsk.sendAsk(kbAskQuestion, models)
  }, [kbAskQuestion, modelDefaults, customModels, kbAsk])

  // --- Sync Tabs on URL Param Change ---
  useEffect(() => {
    if (urlQuery) {
      if (rawMode === 'search' || rawMode === 'ask') {
        setActiveTab('local_search')
        setKbActiveSubTab(rawMode === 'search' ? 'search' : 'ask')
        if (rawMode === 'search') setKbQuery(urlQuery)
        else setKbAskQuestion(urlQuery)
      } else {
        setActiveTab('web_search')
        setWebQuery(urlQuery)
      }
    }
  }, [urlQuery, rawMode])

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto bg-background p-4 md:p-6 space-y-6">
        
        {/* Sleek Gradient Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-background border border-primary/20 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
              Research & Retrieval Hub
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Perform deep research across the internet, retrieve specialized chunks from your notebooks, or query your local knowledge base.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchPastRuns}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant={showHistory ? "default" : "outline"}
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className="relative"
            >
              <History className="h-4 w-4 mr-2" />
              History
              {pastRuns.length > 0 && (
                <Badge variant="secondary" className="ml-2 bg-primary/20 text-primary hover:bg-primary/20">
                  {pastRuns.length}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {/* Custom Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full space-y-6">
          <TabsList className="grid grid-cols-3 w-full max-w-3xl bg-muted/65 p-1 border border-border/50 rounded-lg">
            <TabsTrigger value="web_search" className="gap-2 text-sm font-medium py-2 rounded-md">
              <Globe className="h-4 w-4" />
              Web Search
            </TabsTrigger>
            <TabsTrigger value="notebook_search" className="gap-2 text-sm font-medium py-2 rounded-md">
              <BookOpen className="h-4 w-4" />
              Notebook assistant
            </TabsTrigger>
            <TabsTrigger value="local_search" className="gap-2 text-sm font-medium py-2 rounded-md">
              <Database className="h-4 w-4" />
              Knowledge Base
            </TabsTrigger>
          </TabsList>

          {/* -------------------- TAB 1: WEB SEARCH AGENT -------------------- */}
          <TabsContent value="web_search" className="space-y-6 outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              
              {/* Main Search Panel */}
              <div className="lg:col-span-3 space-y-6">
                
                {/* Modern search input card */}
                <Card className="border border-primary/10 shadow-lg bg-card/60 backdrop-blur-md">
                  <CardContent className="pt-6 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="web-query-input" className="sr-only">Web Query</Label>
                      <Textarea
                        id="web-query-input"
                        placeholder="What would you like to research today? Type a query and press Enter..."
                        value={webQuery}
                        onChange={(e) => setWebQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && webStatus !== 'running' && webQuery.trim()) {
                            e.preventDefault()
                            handleWebSearch()
                          }
                        }}
                        rows={3}
                        className="resize-none bg-background/50 border-border focus-visible:ring-primary focus-visible:ring-1 focus-visible:border-primary"
                      />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Press Enter to query. Shift+Enter for new line.</span>
                        <span>Uses SearXNG + local reranking</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/50 pt-4">
                      
                      {/* Configuration triggers */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowWebOptions(!showWebOptions)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Settings className="h-3.5 w-3.5 mr-1.5" />
                        Options & Settings
                      </Button>

                      {/* Run / Cancel buttons */}
                      <div className="flex items-center gap-2">
                        {webStatus === 'running' ? (
                          <Button variant="destructive" size="sm" onClick={handleCancelWebSearch}>
                            <X className="h-4 w-4 mr-2" />
                            Cancel Research
                          </Button>
                        ) : (
                          <Button 
                            disabled={!webQuery.trim()} 
                            size="sm" 
                            onClick={handleWebSearch}
                            className="bg-primary hover:bg-primary/95"
                          >
                            <Sparkles className="h-4 w-4 mr-2" />
                            Search Web
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Collapsible Advanced Settings */}
                    {showWebOptions && (
                      <div className="border-t border-border/50 pt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm animate-in fade-in duration-300">
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Search Limit (SearXNG)</Label>
                          <Select 
                            value={String(searchLimit)} 
                            onValueChange={(val) => setSearchLimit(Number(val))}
                          >
                            <SelectTrigger className="w-full h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10 results</SelectItem>
                              <SelectItem value="20">20 results</SelectItem>
                              <SelectItem value="30">30 results</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">Maximum URLs retrieved from query</p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Retrieve Top K (BM25)</Label>
                          <Select 
                            value={String(retrieveTopK)} 
                            onValueChange={(val) => setRetrieveTopK(Number(val))}
                          >
                            <SelectTrigger className="w-full h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="20">20 chunks</SelectItem>
                              <SelectItem value="40">40 chunks</SelectItem>
                              <SelectItem value="60">60 chunks</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">BM25 raw lexical candidate count</p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Rerank Top K</Label>
                          <Select 
                            value={String(rerankTopK)} 
                            onValueChange={(val) => setRerankTopK(Number(val))}
                          >
                            <SelectTrigger className="w-full h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="5">5 chunks</SelectItem>
                              <SelectItem value="10">10 chunks</SelectItem>
                              <SelectItem value="15">15 chunks</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">Passed to neural model</p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-muted-foreground">Context Top K (Ollama)</Label>
                          <Select 
                            value={String(contextTopK)} 
                            onValueChange={(val) => setContextTopK(Number(val))}
                          >
                            <SelectTrigger className="w-full h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="3">3 sources</SelectItem>
                              <SelectItem value="6">6 sources</SelectItem>
                              <SelectItem value="9">9 sources</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">Passed as LLM prompt context</p>
                        </div>

                        <div className="flex items-center space-x-2 pt-6">
                          <Checkbox
                            id="gen-answer-check"
                            checked={generateAnswer}
                            onCheckedChange={(c) => setGenerateAnswer(!!c)}
                          />
                          <Label htmlFor="gen-answer-check" className="text-xs font-semibold cursor-pointer">
                            Generate LLM Answer
                          </Label>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Progress Indicators & Terminal Logs */}
                {webStatus === 'running' && (
                  <Card className="border border-border/80 shadow-md">
                    <CardHeader className="py-4 border-b border-border/50">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Activity className="h-4 w-4 text-primary animate-pulse" />
                          Research Pipeline Execution
                        </CardTitle>
                        <Badge variant="outline" className="animate-pulse bg-primary/5 text-primary border-primary/20">
                          Processing
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-6">
                      
                      {/* Step Bubbles */}
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                        {[
                          { key: 'search', label: 'Web Search' },
                          { key: 'fetch', label: 'Fetch Pages' },
                          { key: 'chunk', label: 'Chunk Text' },
                          { key: 'retrieve', label: 'BM25 Index' },
                          { key: 'rerank', label: 'Local Rerank' },
                          { key: 'generate', label: 'LLM Synthesizer' },
                        ].map((step, idx) => {
                          const state = stepsStatus[step.key]
                          return (
                            <div key={step.key} className="flex flex-col items-center text-center space-y-2">
                              <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                                state === 'success' ? 'bg-green-500/10 border-green-500 text-green-500' :
                                state === 'failed' ? 'bg-red-500/10 border-red-500 text-red-500' :
                                state === 'running' ? 'bg-primary/10 border-primary text-primary animate-pulse scale-110 shadow-sm' :
                                'bg-muted border-border text-muted-foreground'
                              }`}>
                                {state === 'success' ? <Check className="w-4 h-4" /> :
                                 state === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                 idx + 1}
                              </div>
                              <span className="text-xs font-medium text-muted-foreground">{step.label}</span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Log Console Terminal */}
                      <div className="rounded-lg bg-black border border-zinc-800 p-4">
                        <div className="flex items-center gap-2 text-zinc-400 text-xs font-mono mb-2 pb-2 border-b border-zinc-800/80">
                          <Terminal className="h-3.5 w-3.5" />
                          <span>System logs console</span>
                        </div>
                        <ScrollArea className="h-40 font-mono text-[11px] text-zinc-300 space-y-1.5">
                          {liveLogs.map((log, i) => (
                            <div key={i} className="leading-5">
                              <span className="text-zinc-600 mr-2">[{new Date().toLocaleTimeString()}]</span>
                              <span>{log}</span>
                            </div>
                          ))}
                        </ScrollArea>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Synthesis Answer Result */}
                {(answerText || webStatus === 'completed') && (
                  <div className="space-y-6">
                    {generateAnswer && (
                      <Card className="border border-border/80 shadow-md">
                        <CardHeader className="py-4 border-b border-border/50 bg-muted/20 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            Research Synthesis
                          </CardTitle>
                          {webStatus === 'completed' && (
                            <Badge variant="outline" className="bg-green-500/5 text-green-500 border-green-500/20">
                              Ready
                            </Badge>
                          )}
                        </CardHeader>
                        <CardContent className="pt-6">
                          {answerText ? (
                            <MarkdownRenderer 
                              children={formattedAnswer} 
                              components={customMarkdownComponents}
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No answer was synthesized.</p>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Retrieved Sources list */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        Source Citations ({results.length})
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.map((res: any, idx: number) => {
                          const citationNum = idx + 1
                          const domain = getDomain(res.chunk.url)
                          const isHighlighted = highlightedChunkIndex === citationNum

                          return (
                            <Card 
                              id={`source-chunk-${citationNum}`} 
                              key={res.chunk.chunk_id || idx}
                              className={`transition-all duration-500 border border-border/60 hover:shadow-md ${
                                isHighlighted ? 'ring-2 ring-primary bg-primary/5 scale-[1.01]' : ''
                              }`}
                            >
                              <CardContent className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-5 h-5 rounded bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-xs font-bold">
                                      {citationNum}
                                    </div>
                                    {res.chunk.url ? (
                                      <a 
                                        href={res.chunk.url} 
                                        target="_blank" 
                                        rel="noopener noreferrer" 
                                        className="text-xs font-bold text-foreground hover:underline flex items-center gap-1 max-w-[180px] md:max-w-[220px] truncate"
                                      >
                                        {res.chunk.title || 'Untitled Source'}
                                        <ExternalLink className="h-3 w-3 inline shrink-0" />
                                      </a>
                                    ) : (
                                      <span className="text-xs font-bold">{res.chunk.title || 'Untitled Chunk'}</span>
                                    )}
                                  </div>
                                  <Badge variant="secondary" className="text-[10px] font-normal uppercase py-0.5">
                                    {domain}
                                  </Badge>
                                </div>

                                <p className="text-xs text-muted-foreground line-clamp-3 bg-muted/30 p-2 rounded">
                                  {res.chunk.text}
                                </p>

                                <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/50 pt-2">
                                  <div className="flex items-center gap-2">
                                    <span>BM25 Rank: <span className="font-semibold">{res.bm25_rank}</span></span>
                                    <span>Score: <span className="font-semibold">{res.bm25_score.toFixed(2)}</span></span>
                                  </div>
                                  <div className="flex items-center gap-2 border-l border-border/80 pl-2">
                                    <span>Rerank Rank: <span className="font-semibold">{res.reranker_rank}</span></span>
                                    <span>Score: <span className="font-semibold">{res.reranker_score.toFixed(4)}</span></span>
                                  </div>
                                </div>

                                <Collapsible>
                                  <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="w-full text-[10px] h-6 mt-1">
                                      View Full Text Chunk <ChevronDown className="h-3 w-3 ml-1" />
                                    </Button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent className="pt-2 animate-in fade-in duration-200">
                                    <div className="text-xs text-zinc-700 dark:text-zinc-300 leading-5 bg-background border border-border/85 p-3 rounded-md max-h-60 overflow-y-auto select-text font-serif">
                                      {res.chunk.text}
                                    </div>
                                  </CollapsibleContent>
                                </Collapsible>
                              </CardContent>
                            </Card>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar Config / Metrics & Analytics */}
              <div className="space-y-6">
                
                {/* Metrics / Analytics Card */}
                {(timing || metrics) && (
                  <Card className="border border-border/80 shadow-md">
                    <CardHeader className="py-4 border-b border-border/50">
                      <CardTitle className="text-xs uppercase font-extrabold text-muted-foreground flex items-center gap-1.5">
                        <Activity className="h-4 w-4 text-primary" />
                        Execution metrics
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-4">
                      
                      {/* Timing Table */}
                      {timing && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3 text-muted-foreground" />
                            Timings (Seconds)
                          </h4>
                          <div className="border border-border rounded overflow-hidden text-xs">
                            {[
                              { key: 'search_time', label: 'Web Search' },
                              { key: 'fetch_time', label: 'Web Fetch' },
                              { key: 'extraction_time', label: 'Extraction' },
                              { key: 'chunking_time', label: 'Chunking' },
                              { key: 'bm25_time', label: 'BM25 Retrieval' },
                              { key: 'reranking_time', label: 'Neural Rerank' },
                              { key: 'llm_time', label: 'Ollama LLM' },
                              { key: 'time_to_first_token', label: 'TTFT' },
                              { key: 'total_time', label: 'Total Time' },
                            ].map((item) => {
                              const value = timing[item.key]
                              if (value === undefined) return null
                              return (
                                <div key={item.key} className="flex items-center justify-between p-2 border-b border-border last:border-0 bg-background/50">
                                  <span className="text-muted-foreground">{item.label}</span>
                                  <span className="font-mono font-semibold">{value}s</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Quantities Table */}
                      {metrics && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1">
                            <FileText className="w-3 h-3 text-muted-foreground" />
                            Statistics
                          </h4>
                          <div className="border border-border rounded overflow-hidden text-xs">
                            {[
                              { key: 'search_results_count', label: 'Raw Results' },
                              { key: 'duplicate_urls_removed', label: 'Duplicates Removed' },
                              { key: 'fetched_success_count', label: 'Fetches Succeeded' },
                              { key: 'fetched_failed_count', label: 'Fetches Failed' },
                              { key: 'chunks_created', label: 'Chunks Segmented' },
                              { key: 'chunks_retrieved', label: 'BM25 Candidates' },
                              { key: 'chunks_reranked', label: 'Neural Candidates' },
                              { key: 'sources_used_count', label: 'Sources In Context' },
                            ].map((item) => {
                              const value = metrics[item.key]
                              if (value === undefined) return null
                              return (
                                <div key={item.key} className="flex items-center justify-between p-2 border-b border-border last:border-0 bg-background/50">
                                  <span className="text-muted-foreground">{item.label}</span>
                                  <span className="font-semibold">{value}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex flex-col sm:flex-row lg:flex-col gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={handleExportJSON} className="w-full text-xs h-8">
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          Export Run JSON
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleExportCSV} className="w-full text-xs h-8">
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          Export Metrics CSV
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Empty State Instructions */}
                {webStatus === 'idle' && (
                  <Card className="border border-dashed border-border/80 shadow-sm">
                    <CardHeader className="py-4">
                      <CardTitle className="text-xs uppercase font-extrabold text-muted-foreground flex items-center gap-1.5">
                        <MessageCircleQuestion className="h-4 w-4" />
                        How to use Web Search
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground space-y-3 leading-5">
                      <p>
                        1. **Input query**: Ask any complex research question.
                      </p>
                      <p>
                        2. **Retrieve sources**: The engine fetches the top URLs from SearXNG, parses them with Trafilatura, and indexes them with BM25.
                      </p>
                      <p>
                        3. **Local Reranking**: It scores passages locally using our `bge-reranker-v2-m3` cross-encoder model.
                      </p>
                      <p>
                        4. **Synthesized Answer**: Ollama outputs an authoritative reply cited with source indicators.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* -------------------- TAB 2: NOTEBOOK ASSISTANT -------------------- */}
          <TabsContent value="notebook_search" className="space-y-6 outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              
              {/* Notebook Picker & Sources checklist */}
              <div className="lg:col-span-1 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Select Target Notebook</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Notebook</Label>
                      <Select 
                        value={selectedNotebookId} 
                        onValueChange={(val) => {
                          setSelectedNotebookId(val)
                          setSelectedSourceIds([])
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select notebook..." />
                        </SelectTrigger>
                        <SelectContent>
                          {notebooks?.map((nb: any) => (
                            <SelectItem key={nb.id} value={nb.id}>{nb.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Sources Selection Checklist */}
                    {selectedNotebookId && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">Filter Sources</Label>
                          {selectedSourceIds.length > 0 && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => setSelectedSourceIds([])}
                              className="h-auto p-0 text-[10px] text-muted-foreground hover:text-foreground"
                            >
                              Reset
                            </Button>
                          )}
                        </div>
                        <ScrollArea className="h-64 border rounded p-2 bg-background/50">
                          {isLoadingSources ? (
                            <div className="flex items-center justify-center h-full">
                              <LoadingSpinner size="sm" />
                            </div>
                          ) : notebookSources && notebookSources.length > 0 ? (
                            <div className="space-y-2">
                              {notebookSources.map((src: any) => (
                                <div key={src.id} className="flex items-center space-x-2 p-1 rounded hover:bg-muted/40">
                                  <Checkbox
                                    id={`check-${src.id}`}
                                    checked={selectedSourceIds.includes(src.id)}
                                    onCheckedChange={() => handleToggleSourceId(src.id)}
                                  />
                                  <Label 
                                    htmlFor={`check-${src.id}`} 
                                    className="text-xs font-medium cursor-pointer truncate max-w-[170px]"
                                  >
                                    {src.title || 'Untitled Source'}
                                  </Label>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground italic text-center pt-8">No sources in notebook.</p>
                          )}
                        </ScrollArea>
                        <p className="text-[10px] text-muted-foreground">If none checked, retrieves from all sources in the notebook.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Main Query & Output Panel */}
              <div className="lg:col-span-3 space-y-6">
                <Card>
                  <CardHeader className="py-4 border-b border-border/50">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Retrieve & Answer from Notebook Context
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="notebook-query-input">Query</Label>
                      <div className="flex gap-2">
                        <Input
                          id="notebook-query-input"
                          placeholder="Ask a question about your notebook documents..."
                          value={notebookQuery}
                          onChange={(e) => setNotebookQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && notebookStatus !== 'loading' && notebookQuery.trim()) {
                              handleNotebookSearch()
                            }
                          }}
                          className="flex-1"
                        />
                        <Button 
                          onClick={handleNotebookSearch} 
                          disabled={notebookStatus === 'loading' || !selectedNotebookId || !notebookQuery.trim()}
                        >
                          {notebookStatus === 'loading' ? <LoadingSpinner size="sm" /> : <Play className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>

                    {/* Basic Retrieval options */}
                    <div className="flex items-center gap-6 text-sm pt-2">
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          id="nb-gen-answer" 
                          checked={notebookGenerateAnswer}
                          onCheckedChange={(c) => setNotebookGenerateAnswer(!!c)}
                        />
                        <Label htmlFor="nb-gen-answer" className="text-xs font-semibold cursor-pointer">Generate LLM Answer</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">Retrieve limit:</span>
                        <Select 
                          value={String(notebookLimit)} 
                          onValueChange={(val) => setNotebookLimit(Number(val))}
                        >
                          <SelectTrigger className="w-20 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="6">6</SelectItem>
                            <SelectItem value="10">10</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {notebookStatus === 'loading' && (
                  <div className="flex justify-center py-12">
                    <LoadingSpinner size="md" />
                  </div>
                )}

                {notebookStatus === 'error' && (
                  <Card className="border-red-500/20 bg-red-500/5">
                    <CardContent className="pt-6 flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <h4 className="text-sm font-bold text-red-500">Retrieval Failed</h4>
                        <p className="text-xs text-red-400 mt-1">{notebookError}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Notebook search results */}
                {notebookStatus === 'success' && (
                  <div className="space-y-6">
                    {notebookGenerateAnswer && notebookAnswer && (
                      <Card className="border border-border/80 shadow-md">
                        <CardHeader className="py-4 border-b border-border/50">
                          <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            Notebook synthesis
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                          <MarkdownRenderer children={notebookAnswer} />
                        </CardContent>
                      </Card>
                    )}

                    <div className="space-y-3">
                      <h4 className="text-xs uppercase font-extrabold text-muted-foreground tracking-wider">
                        Retrieved document chunks ({notebookResults.length})
                      </h4>
                      <div className="space-y-3">
                        {notebookResults.map((res: any, idx: number) => (
                          <Card key={res.chunk.chunk_id || idx} className="border border-border/70">
                            <CardContent className="p-4 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-foreground">
                                  {res.chunk.title || 'Untitled Source'}
                                </span>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                  <span>BM25 Rank: {res.bm25_rank} (Score: {res.bm25_score.toFixed(2)})</span>
                                  <span className="border-l border-border/80 pl-2">Rerank Rank: {res.reranker_rank} (Score: {res.reranker_score.toFixed(4)})</span>
                                </div>
                              </div>
                              <p className="text-xs text-zinc-700 dark:text-zinc-300 bg-muted/20 p-2.5 rounded font-serif leading-5">
                                {res.chunk.text}
                              </p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* -------------------- TAB 3: LOCAL KNOWLEDGE BASE (ORIGINAL) -------------------- */}
          <TabsContent value="local_search" className="space-y-6 outline-none">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Choose KB Interaction</p>
              <div className="flex gap-2">
                <Button 
                  variant={kbActiveSubTab === 'ask' ? 'default' : 'outline'} 
                  size="sm"
                  onClick={() => setKbActiveSubTab('ask')}
                >
                  <MessageCircleQuestion className="h-4 w-4 mr-2" />
                  Ask KB
                </Button>
                <Button 
                  variant={kbActiveSubTab === 'search' ? 'default' : 'outline'} 
                  size="sm"
                  onClick={() => setKbActiveSubTab('search')}
                >
                  <Search className="h-4 w-4 mr-2" />
                  Keyword Search
                </Button>
              </div>
            </div>

            {kbActiveSubTab === 'ask' ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('searchPage.askYourKb', 'Ask Your Knowledge Base')}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('searchPage.askYourKbDesc', 'The LLM will answer your query based on the documents in your knowledge base.')}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  
                  {/* Question Input */}
                  <div className="space-y-2">
                    <Label htmlFor="ask-question">{t('searchPage.question', 'Question')}</Label>
                    <Textarea
                      id="ask-question"
                      placeholder={t('searchPage.enterQuestionPlaceholder', 'Enter your question...')}
                      value={kbAskQuestion}
                      onChange={(e) => setKbAskQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !kbAsk.isStreaming && kbAskQuestion.trim()) {
                          e.preventDefault()
                          handleKbAsk()
                        }
                      }}
                      disabled={kbAsk.isStreaming}
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">{t('searchPage.pressToSubmit', 'Press Cmd/Ctrl+Enter to submit')}</p>
                  </div>

                  {!hasEmbeddingModel ? (
                    <div className="flex items-center gap-2 p-3 text-sm text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/20 rounded-md">
                      <AlertCircle className="h-4 w-4" />
                      <span>{t('searchPage.noEmbeddingModel', 'No embedding model configured.')}</span>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">
                            {customModels ? t('searchPage.usingCustomModels', 'Using Custom Models') : t('searchPage.usingDefaultModels', 'Using Default Models')}
                          </Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAdvancedModels(true)}
                            disabled={kbAsk.isStreaming}
                            className="h-auto py-1 px-2"
                          >
                            <Settings className="h-3 w-3 mr-1" />
                            {t('searchPage.advanced', 'Advanced')}
                          </Button>
                        </div>
                        <div className="flex gap-2 text-xs flex-wrap">
                          <Badge variant="secondary">
                            {t('searchPage.strategy', 'Strategy')}: {resolveModelName(customModels?.strategy || modelDefaults?.default_chat_model)}
                          </Badge>
                          <Badge variant="secondary">
                            {t('searchPage.answer', 'Answer')}: {resolveModelName(customModels?.answer || modelDefaults?.default_chat_model)}
                          </Badge>
                          <Badge variant="secondary">
                            {t('searchPage.final', 'Final')}: {resolveModelName(customModels?.finalAnswer || modelDefaults?.default_chat_model)}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                          onClick={handleKbAsk}
                          disabled={kbAsk.isStreaming || !kbAskQuestion.trim()}
                          className="w-full"
                        >
                          {kbAsk.isStreaming ? (
                            <>
                              <LoadingSpinner size="sm" className="mr-2" />
                              {t('searchPage.processing', 'Processing...')}
                            </>
                          ) : (
                            t('searchPage.ask', 'Ask KB')
                          )}
                        </Button>

                        {kbAsk.finalAnswer && (
                          <Button
                            variant="outline"
                            onClick={() => setShowSaveDialog(true)}
                            className="w-full"
                          >
                            <Save className="h-4 w-4 mr-2" />
                            {t('searchPage.saveToNotebooks', 'Save to Notebooks')}
                          </Button>
                        )}
                      </div>
                    </>
                  )}

                  {/* Streaming Response */}
                  <StreamingResponse
                    isStreaming={kbAsk.isStreaming}
                    strategy={kbAsk.strategy}
                    answers={kbAsk.answers}
                    finalAnswer={kbAsk.finalAnswer}
                  />

                  {/* Advanced Models Dialog */}
                  <AdvancedModelsDialog
                    open={showAdvancedModels}
                    onOpenChange={setShowAdvancedModels}
                    defaultModels={{
                      strategy: customModels?.strategy || modelDefaults?.default_chat_model || '',
                      answer: customModels?.answer || modelDefaults?.default_chat_model || '',
                      finalAnswer: customModels?.finalAnswer || modelDefaults?.default_chat_model || ''
                    }}
                    onSave={setCustomModels}
                  />

                  {/* Save to Notebooks Dialog */}
                  {kbAsk.finalAnswer && (
                    <SaveToNotebooksDialog
                      open={showSaveDialog}
                      onOpenChange={setShowSaveDialog}
                      question={kbAskQuestion}
                      answer={kbAsk.finalAnswer}
                    />
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('searchPage.search', 'Search')}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('searchPage.searchDesc', 'Search your knowledge base for specific keywords or concepts')}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        placeholder={t('searchPage.enterSearchPlaceholder', 'Enter search query...')}
                        value={kbQuery}
                        onChange={(e) => setKbQuery(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') handleKbSearch()
                        }}
                        disabled={kbSearchMutation.isPending}
                        className="flex-1"
                      />
                      <Button
                        onClick={handleKbSearch}
                        disabled={kbSearchMutation.isPending || !kbQuery.trim()}
                      >
                        {kbSearchMutation.isPending ? <LoadingSpinner size="sm" /> : <Search className="h-4 w-4 mr-2" />}
                        {t('searchPage.search', 'Search')}
                      </Button>
                    </div>
                  </div>

                  {/* Options */}
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <span className="text-sm font-medium leading-none">{t('searchPage.searchType', 'Search Type')}</span>
                      {!hasEmbeddingModel && (
                        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
                          <AlertCircle className="h-4 w-4" />
                          <span>{t('searchPage.vectorSearchWarning', 'Vector search requires an embedding model.')}</span>
                        </div>
                      )}
                      <RadioGroup
                        value={kbSearchType}
                        onValueChange={(value: 'text' | 'vector') => setKbSearchType(value)}
                        disabled={modelsLoading || kbSearchMutation.isPending}
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="text" id="kb-text" />
                          <Label htmlFor="kb-text" className="font-normal cursor-pointer">
                            {t('searchPage.textSearch', 'Text Search')}
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem
                            value="vector"
                            id="kb-vector"
                            disabled={!hasEmbeddingModel || kbSearchMutation.isPending}
                          />
                          <Label
                            htmlFor="kb-vector"
                            className={`font-normal ${!hasEmbeddingModel ? 'text-muted-foreground cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            {t('searchPage.vectorSearch', 'Vector Search')}
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    <div className="space-y-2">
                      <span className="text-sm font-medium leading-none">{t('searchPage.searchIn', 'Search In')}</span>
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="kb-sources"
                            checked={kbSearchSources}
                            onCheckedChange={(checked) => setKbSearchSources(checked as boolean)}
                            disabled={kbSearchMutation.isPending}
                          />
                          <Label htmlFor="kb-sources" className="font-normal cursor-pointer">
                            {t('searchPage.searchSources', 'Search Sources')}
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="kb-notes"
                            checked={kbSearchNotes}
                            onCheckedChange={(checked) => setKbSearchNotes(checked as boolean)}
                            disabled={kbSearchMutation.isPending}
                          />
                          <Label htmlFor="kb-notes" className="font-normal cursor-pointer">
                            {t('searchPage.searchNotes', 'Search Notes')}
                          </Label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* KB Results list */}
                  {kbSearchMutation.data && (
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">
                          {t('searchPage.resultsFound', '{count} results found').replace('{count}', kbSearchMutation.data.total_count.toString())}
                        </h3>
                        <Badge variant="outline">{kbSearchMutation.data.search_type === 'text' ? t('searchPage.textSearch', 'Text') : t('searchPage.vector', 'Vector')}</Badge>
                      </div>

                      {kbSearchMutation.data.results.length === 0 ? (
                        <Card>
                          <CardContent className="pt-6 text-center text-muted-foreground">
                            {t('searchPage.noResultsFor', 'No results for “{query}”').replace('{query}', kbQuery)}
                          </CardContent>
                        </Card>
                      ) : (
                        <div className="space-y-2">
                          {kbSearchMutation.data.results.map((result: any, index: number) => {
                            if (!result.parent_id) return null
                            const [type, id] = result.parent_id.split(':')
                            const modalType = type === 'source_insight' ? 'insight' : type as 'source' | 'note' | 'insight'

                            return (
                              <Card key={index}>
                                <CardContent className="pt-4">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                      <button
                                        onClick={() => openModal(modalType, id)}
                                        className="text-primary hover:underline font-medium text-left"
                                      >
                                        {result.title}
                                      </button>
                                      <Badge variant="secondary" className="ml-2">
                                        {result.final_score.toFixed(2)}
                                      </Badge>
                                    </div>
                                  </div>

                                  {result.matches && result.matches.length > 0 && (
                                    <Collapsible className="mt-3">
                                      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                                        <ChevronDown className="h-4 w-4" />
                                        {t('searchPage.matches', 'Matches ({count})').replace('{count}', result.matches.length.toString())}
                                      </CollapsibleTrigger>
                                      <CollapsibleContent className="mt-2 space-y-1">
                                        {result.matches.map((match: string, i: number) => (
                                          <div key={i} className="text-sm pl-6 py-1 border-l-2 border-muted">
                                            {match}
                                          </div>
                                        ))}
                                      </CollapsibleContent>
                                    </Collapsible>
                                  )}
                                </CardContent>
                              </Card>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* -------------------- SIDE DRAWER: RUN HISTORY -------------------- */}
        {showHistory && (
          <div className="fixed inset-y-0 right-0 w-80 bg-background border-l border-border shadow-2xl z-50 p-6 flex flex-col justify-between animate-in slide-in-from-right duration-300">
            <div className="space-y-6 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between border-b border-border/80 pb-4">
                <h3 className="font-extrabold text-foreground flex items-center gap-2 text-sm uppercase tracking-wider">
                  <History className="h-4 w-4 text-primary" />
                  Search History
                </h3>
                <Button variant="ghost" size="icon" onClick={() => setShowHistory(false)} className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner size="md" />
                </div>
              ) : pastRuns.length > 0 ? (
                <div className="space-y-3 pr-2">
                  {pastRuns.map((run) => (
                    <div 
                      key={run.id}
                      onClick={() => handleLoadPastRun(run)}
                      className={`group p-3 rounded-lg border border-border/60 hover:bg-muted/40 hover:border-primary/20 cursor-pointer transition-all duration-200 relative flex flex-col justify-between gap-1.5 ${
                        runId === run.id ? 'bg-primary/5 border-primary/20 ring-1 ring-primary/10' : 'bg-card'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground line-clamp-2 max-w-[190px]">
                          {run.query}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => handleDeleteRun(e, run.id)}
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-600 hover:bg-red-500/10 shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{new Date(run.created).toLocaleDateString()}</span>
                        <Badge 
                          variant="outline" 
                          className={`text-[9px] font-normal uppercase py-0 px-1.5 ${
                            run.status === 'completed' ? 'border-green-500/20 text-green-500 bg-green-500/5' :
                            run.status === 'failed' ? 'border-red-500/20 text-red-500 bg-red-500/5' :
                            run.status === 'cancelled' ? 'border-amber-500/20 text-amber-500 bg-amber-500/5' :
                            'border-blue-500/20 text-blue-500 bg-blue-500/5'
                          }`}
                        >
                          {run.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic text-center py-12">No search runs yet.</p>
              )}
            </div>
            
            <div className="border-t border-border/80 pt-4 flex flex-col gap-2">
              <p className="text-[10px] text-muted-foreground text-center">
                Runs are automatically saved to SurrealDB.
              </p>
            </div>
          </div>
        )}

      </div>
    </AppShell>
  )
}
