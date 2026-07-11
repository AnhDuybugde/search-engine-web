'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from '@/lib/hooks/use-translation'
import { AppShell } from '@/components/layout/AppShell'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { 
  Search, 
  ChevronDown, 
  AlertCircle, 
  Settings, 
  Sparkles,
  Activity,
  X,
  FileText,
  ExternalLink,
  History,
  Trash2,
  RefreshCw,
  Clock,
  Check,
  Loader2
} from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import apiClient from '@/lib/api/client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export default function SearchPage() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const urlQuery = searchParams?.get('q') || ''
  const historyParam = searchParams?.get('history')
  
  // --- Web Search State ---
  const [webQuery, setWebQuery] = useState('')
  const [searchLimit, setSearchLimit] = useState(8)
  const [retrieveTopK, setRetrieveTopK] = useState(20)
  const [rerankTopK, setRerankTopK] = useState(5)
  const [contextTopK, setContextTopK] = useState(5)
  const [generateAnswer, setGenerateAnswer] = useState(true)
  const [boostSpeed, setBoostSpeed] = useState(true)
  const [retrievalMethod, setRetrievalMethod] = useState<'bm25' | 'our-method'>('our-method')
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

  const abortControllerRef = useRef<AbortController | null>(null)

  // --- Fetch Past Web Search Runs ---
  const fetchPastRuns = useCallback(async () => {
    setIsLoadingHistory(true)
    try {
      const response = await apiClient.get<any[]>('/search/runs', {
        params: { summary: true, limit: 50 }
      })
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
        setLiveLogs(prev => {
          const methodLabel = data.method === 'our-method' ? 'Our Method (BGE + RRF)' : 'BM25'
          const newLogs = [...prev, `✅ ${methodLabel} completed: retrieved ${data.count} candidates.`]
          if (boostSpeed) {
            newLogs.push(`⚡ Fast Mode active: skipping neural cross-encoder reranking...`)
          } else {
            newLogs.push(`⚡ Executing bge-reranker-v2-m3 local cross-encoder model...`)
          }
          return newLogs
        })
        break
        
      case 'reranking_completed':
        setStepsStatus(prev => ({ ...prev, rerank: 'success', generate: 'running' }))
        setLiveLogs(prev => {
          if (data.bypassed) {
            return [
              ...prev,
              `✅ Fast Mode: bypassed neural cross-encoder. Used BM25 scores directly.`,
            ]
          } else {
            return [
              ...prev,
              `✅ Cross-Encoder scoring finished. Filtered down to top ${data.count} most relevant passages.`,
            ]
          }
        })
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
        generate_answer: generateAnswer,
        boost_speed: boostSpeed,
        retrieval_method: retrievalMethod
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
    try {
      const response = await apiClient.get<any>(`/search/runs/${run.id}`)
      const fullRun = response.data || run

      setRunId(fullRun.id)
      setWebQuery(fullRun.query)
      setWebStatus(fullRun.status)
      setAnswerText(fullRun.generated_answer || '')
      setResults(fullRun.results || [])
      setTiming(fullRun.timing || null)
      setMetrics(fullRun.metrics || null)
      setWebError(fullRun.error || null)
      
      const wasSuccess = fullRun.status === 'completed'
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
    } catch (err) {
      toast.error('Failed to load run details')
      console.error('Failed to load run details:', err)
    }
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

  // --- Sync URL Param Change ---
  useEffect(() => {
    if (urlQuery) {
      setWebQuery(urlQuery)
    }
    if (historyParam === 'true') {
      setShowHistory(true)
    }
  }, [urlQuery, historyParam])

  return (
    <AppShell>
      <div className="flex-1 flex flex-col h-full bg-background/50 overflow-y-auto relative animate-in fade-in duration-300">
        {/* Glowing abstract background circle */}
        <div className="absolute top-[-20%] left-[20%] w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[10%] w-[400px] h-[400px] rounded-full bg-primary/5 blur-[100px] pointer-events-none" />

        {/* Floating history trigger at top right */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPastRuns}
            className="text-muted-foreground hover:text-foreground h-8 text-xs bg-background/40 backdrop-blur-sm"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
          <Button
            variant={showHistory ? "default" : "outline"}
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            className="h-8 text-xs relative bg-background/40 backdrop-blur-sm"
          >
            <History className="h-3.5 w-3.5 mr-1" />
            History
            {pastRuns.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 bg-primary/20 text-primary hover:bg-primary/20 text-[10px] px-1 py-0">
                {pastRuns.length}
              </Badge>
            )}
          </Button>
        </div>

        {/* Main Content Area */}
        <div className={cn(
          "flex-1 flex flex-col w-full max-w-4xl mx-auto px-4 md:px-6 transition-all duration-500",
          webStatus === 'idle' ? "justify-center py-16" : "pt-16 pb-24 space-y-6"
        )}>
          {/* Welcome/Branding (Only shown in Idle state) */}
          {webStatus === 'idle' && (
            <div className="text-center space-y-3 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-semibold">
                <Sparkles className="h-3 w-3 animate-pulse" />
                <span>Next-Gen Web Search Agent</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/75 bg-clip-text text-transparent">
                Where Knowledge Begins
              </h1>
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Ask a complex question, and our AI web agent will search, retrieve, and synthesize an authoritative answer.
              </p>
            </div>
          )}

          {/* Perplexity-inspired Composer Box */}
          <div className={cn(
            "w-full transition-all duration-500",
            webStatus !== 'idle' ? "sticky top-4 z-20" : ""
          )}>
            <Card className="border border-primary/15 shadow-xl bg-card/70 backdrop-blur-md overflow-hidden transition-all duration-300 hover:border-primary/25">
              <CardContent className="p-3 md:p-4 space-y-3">
                <div className="relative">
                  <Textarea
                    id="web-query-input"
                    placeholder="Ask anything..."
                    value={webQuery}
                    onChange={(e) => setWebQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && webStatus !== 'running' && webQuery.trim()) {
                        e.preventDefault()
                        handleWebSearch()
                      }
                    }}
                    rows={webStatus === 'idle' ? 3 : 1}
                    className="resize-none bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-2 pt-1 pb-1 text-sm md:text-base placeholder:text-muted-foreground/60 w-full min-h-[40px] focus:outline-none focus:ring-0"
                  />
                </div>

                <div className="flex items-center justify-between border-t border-border/45 pt-2.5">
                  <div className="flex items-center gap-1.5">
                    {/* Settings Trigger */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowWebOptions(!showWebOptions)}
                      className={cn(
                        "h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground",
                        showWebOptions ? "bg-muted text-foreground" : ""
                      )}
                    >
                      <Settings className="h-3.5 w-3.5 mr-1" />
                      Configure
                    </Button>
                    {boostSpeed ? (
                      <span className="text-[10px] text-primary/90 font-semibold hidden sm:inline-flex items-center gap-1">
                        <Sparkles className="h-2.5 w-2.5 inline text-primary animate-pulse" />
                        • Fast Mode (Neural Reranker Bypassed)
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/65 hidden sm:inline">• Web + Neural Reranker</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {webStatus === 'running' ? (
                      <Button variant="destructive" size="sm" className="h-8 text-xs gap-1.5" onClick={handleCancelWebSearch}>
                        <X className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        disabled={!webQuery.trim()}
                        size="sm"
                        onClick={handleWebSearch}
                        className="bg-primary hover:bg-primary/95 text-primary-foreground h-8 text-xs font-semibold px-4 rounded-lg shadow-sm gap-1.5"
                      >
                        <Search className="h-3.5 w-3.5" />
                        Search
                      </Button>
                    )}
                  </div>
                </div>

                {/* Collapsible Advanced Options inside composer */}
                {showWebOptions && (
                  <div className="border-t border-border/40 pt-3 space-y-3.5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">IR Method</Label>
                        <Select value={retrievalMethod} onValueChange={(val) => setRetrievalMethod(val as 'bm25' | 'our-method')}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="our-method">Our Method</SelectItem>
                            <SelectItem value="bm25">BM25</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">Search Limit</Label>
                        <Select value={String(searchLimit)} onValueChange={(val) => setSearchLimit(Number(val))}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="8">8 results</SelectItem>
                            <SelectItem value="10">10 results</SelectItem>
                            <SelectItem value="20">20 results</SelectItem>
                            <SelectItem value="30">30 results</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">Retrieve Top K</Label>
                        <Select value={String(retrieveTopK)} onValueChange={(val) => setRetrieveTopK(Number(val))}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="20">20 chunks</SelectItem>
                            <SelectItem value="40">40 chunks</SelectItem>
                            <SelectItem value="60">60 chunks</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">Rerank Top K</Label>
                        <Select value={String(rerankTopK)} onValueChange={(val) => setRerankTopK(Number(val))}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5">5 chunks</SelectItem>
                            <SelectItem value="10">10 chunks</SelectItem>
                            <SelectItem value="15">15 chunks</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">Context Top K</Label>
                        <Select value={String(contextTopK)} onValueChange={(val) => setContextTopK(Number(val))}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3">3 sources</SelectItem>
                            <SelectItem value="6">6 sources</SelectItem>
                            <SelectItem value="9">9 sources</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 pt-2.5 border-t border-border/25">
                      <Checkbox
                        id="boost-speed"
                        checked={boostSpeed}
                        onCheckedChange={(checked) => setBoostSpeed(!!checked)}
                        className="mt-0.5"
                      />
                      <div className="grid gap-1 leading-none">
                        <label
                          htmlFor="boost-speed"
                          className="text-xs font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-1 cursor-pointer select-none text-foreground hover:text-primary transition-colors"
                        >
                          <Sparkles className="h-3 w-3 text-primary animate-pulse" />
                          Boost Speed (Fast Mode)
                        </label>
                        <p className="text-[10.5px] text-muted-foreground/80">
                          Bypasses the CPU-heavy neural reranker (cross-encoder) and limits fetching to the top 5 pages to retrieve answers in under 10 seconds.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pipeline Status Tracker */}
          {(webStatus === 'running' || webStatus === 'completed' || webStatus === 'failed' || webStatus === 'cancelled') && (
            <Card className="border border-border/70 shadow-sm bg-card/50 backdrop-blur-sm overflow-hidden animate-in slide-in-from-top-2 duration-300">
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="space-y-1">
                    <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider">
                      <Activity className="h-3.5 w-3.5 text-primary animate-pulse" />
                      Research Pipeline Progress
                    </h3>
                    <p className="text-[10px] text-muted-foreground">
                      {webStatus === 'running' ? 'Agent is actively executing search and synthesis...' : 
                       webStatus === 'completed' ? 'Research synthesis completed successfully.' : 
                       webStatus === 'cancelled' ? 'Search run was cancelled.' : 'Pipeline failed during execution.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {webStatus === 'running' && <LoadingSpinner size="sm" className="mr-2" />}
                    <Badge variant="outline" className={cn(
                      "text-[10px] font-semibold py-0.5 px-2 transition-all duration-300",
                      webStatus === 'completed' ? "border-green-500/20 text-green-500 bg-green-500/5" :
                      webStatus === 'failed' ? "border-red-500/20 text-red-500 bg-red-500/5" :
                      webStatus === 'cancelled' ? "border-amber-500/20 text-amber-500 bg-amber-500/5" :
                      "border-blue-500/20 text-blue-500 bg-blue-500/5"
                    )}>
                      {webStatus.toUpperCase()}
                    </Badge>
                  </div>
                </div>

                {/* Step Indicators */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mt-4 pt-3 border-t border-border/40">
                  {[
                    { key: 'search', label: 'Web Search', desc: 'Querying SearXNG' },
                    { key: 'fetch', label: 'Fetching', desc: 'Downloading Pages' },
                    { key: 'chunk', label: 'Chunking', desc: 'Segmenting Text' },
                    { key: 'retrieve', label: 'Retrieve', desc: 'BM25 Indexing' },
                    { key: 'rerank', label: 'Reranking', desc: 'Neural Cross-Encoder' },
                    { key: 'generate', label: 'Synthesizing', desc: 'Ollama Qwen 2.5' },
                  ].map((step) => {
                    const status = stepsStatus[step.key]
                    const isPending = status === 'pending'
                    const isRunning = status === 'running'
                    const isSuccess = status === 'success'
                    const isFailed = status === 'failed'

                    return (
                      <div 
                        key={step.key} 
                        className={cn(
                          "p-2.5 rounded-lg border flex flex-col gap-1 transition-all duration-300",
                          isSuccess ? "border-green-500/20 bg-green-500/5 text-green-700 dark:text-green-400" :
                          isRunning ? "border-primary bg-primary/5 text-primary shadow-sm" :
                          isFailed ? "border-red-500/20 bg-red-500/5 text-red-700 dark:text-red-400" :
                          "border-border/55 bg-background/25 text-muted-foreground"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold tracking-tight">{step.label}</span>
                          {isSuccess && <Check className="h-3 w-3 text-green-500" />}
                          {isRunning && <Loader2 className="h-3 w-3 text-primary animate-spin" />}
                          {isFailed && <AlertCircle className="h-3 w-3 text-red-500" />}
                          {isPending && <Clock className="h-3 w-3 text-muted-foreground/50" />}
                        </div>
                        <span className="text-[9px] opacity-75 line-clamp-1">{step.desc}</span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results layout (only if not idle) */}
          {webStatus !== 'idle' && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-in fade-in duration-300">
              {/* Left main area: Logs, synthesis, sources */}
              <div className="lg:col-span-3 space-y-6">
                {/* Pipeline logs console */}
                {webStatus === 'running' && (
                  <Card className="border border-border shadow-sm">
                    <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
                      <CardTitle className="text-xs font-bold flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-primary animate-pulse" />
                        Pipeline logs
                      </CardTitle>
                      <Badge variant="outline" className="animate-pulse bg-primary/5 text-primary border-primary/20 text-[10px]">
                        Running
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-3">
                      {/* Log Console Terminal */}
                      <div className="rounded-lg bg-black border border-zinc-800 p-3">
                        <ScrollArea className="h-28 font-mono text-[10px] text-zinc-300 space-y-1 leading-relaxed">
                          {liveLogs.map((log, i) => (
                            <div key={i}>
                              <span className="text-zinc-600 mr-2">[{new Date().toLocaleTimeString()}]</span>
                              <span>{log}</span>
                            </div>
                          ))}
                        </ScrollArea>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Synthesis Answer */}
                {(answerText || webStatus === 'completed') && (
                  <div className="space-y-6">
                    {generateAnswer && (
                      <Card className="border border-border shadow-sm">
                        <CardHeader className="py-3 border-b bg-muted/10 flex flex-row items-center justify-between">
                          <CardTitle className="text-xs font-bold flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            Synthesized Answer
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4 text-sm leading-relaxed prose dark:prose-invert max-w-none">
                          {answerText ? (
                            <MarkdownRenderer 
                              children={formattedAnswer} 
                              components={customMarkdownComponents}
                            />
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No answer was synthesized.</p>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Sources / Citations */}
                    {results.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          Source Citations ({results.length})
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-500">
                          {results.map((res: any, idx: number) => {
                            const citationNum = idx + 1
                            const domain = getDomain(res.chunk.url)
                            const isHighlighted = highlightedChunkIndex === citationNum

                            return (
                              <Card 
                                id={`source-chunk-${citationNum}`} 
                                key={res.chunk.chunk_id || idx}
                                className={cn(
                                  "transition-all duration-500 border border-border/60 hover:shadow-md",
                                  isHighlighted ? "ring-2 ring-primary bg-primary/5 scale-[1.01]" : ""
                                )}
                              >
                                <CardContent className="p-3.5 space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-5 h-5 rounded bg-primary/10 text-primary border border-primary/20 flex items-center justify-center text-[10px] font-bold">
                                        {citationNum}
                                      </div>
                                      {res.chunk.url ? (
                                        <a 
                                          href={res.chunk.url} 
                                          target="_blank" 
                                          rel="noopener noreferrer" 
                                          className="text-xs font-bold text-foreground hover:underline flex items-center gap-1 max-w-[150px] truncate"
                                        >
                                          {res.chunk.title || 'Untitled Source'}
                                          <ExternalLink className="h-2.5 w-2.5 inline shrink-0" />
                                        </a>
                                      ) : (
                                        <span className="text-xs font-bold">{res.chunk.title || 'Untitled Chunk'}</span>
                                      )}
                                    </div>
                                    <Badge variant="secondary" className="text-[9px] font-normal uppercase py-0 px-1">
                                      {domain}
                                    </Badge>
                                  </div>

                                  <p className="text-[11px] text-muted-foreground line-clamp-3 bg-muted/25 p-2 rounded font-mono leading-relaxed">
                                    {res.chunk.text}
                                  </p>

                                  <Collapsible>
                                    <CollapsibleTrigger asChild>
                                      <Button variant="ghost" size="sm" className="w-full text-[9px] h-5 mt-1">
                                        View Full Text Chunk <ChevronDown className="h-2.5 w-2.5 ml-1" />
                                      </Button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent className="pt-1.5 animate-in fade-in duration-200">
                                      <div className="text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed bg-background border border-border p-2.5 rounded max-h-48 overflow-y-auto select-text font-serif">
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
                    )}
                  </div>
                )}
              </div>

              {/* Right main area: Metrics & analytics */}
              <div className="space-y-6">
                {(timing || metrics) && (
                  <Card className="border border-border shadow-sm bg-card/65 backdrop-blur-sm">
                    <CardHeader className="py-3 border-b">
                      <CardTitle className="text-xs uppercase font-extrabold text-muted-foreground flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-primary" />
                        Run metrics
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-3 space-y-3">
                      {timing && (
                        <div className="space-y-1.5">
                          <h4 className="text-[10px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1">
                            <Clock className="w-3 h-3 text-muted-foreground" />
                            Timings
                          </h4>
                          <div className="border border-border rounded overflow-hidden text-[10px]">
                            {[
                              { key: 'search_time', label: 'Web Search' },
                              { key: 'fetch_time', label: 'Web Fetch' },
                              { key: 'extraction_time', label: 'Extraction' },
                              { key: 'chunking_time', label: 'Chunking' },
                              { key: 'bm25_time', label: 'BM25 Retrieval' },
                              { key: 'reranking_time', label: 'Neural Rerank' },
                              { key: 'llm_time', label: 'Ollama LLM' },
                              { key: 'total_time', label: 'Total Time' },
                            ].map((item) => {
                              const value = timing[item.key]
                              if (value === undefined) return null
                              return (
                                <div key={item.key} className="flex items-center justify-between p-1.5 border-b border-border last:border-0 bg-background/30">
                                  <span className="text-muted-foreground">{item.label}</span>
                                  <span className="font-mono font-semibold">{value}s</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {metrics && (
                        <div className="space-y-1.5">
                          <h4 className="text-[10px] font-bold text-foreground uppercase tracking-wider flex items-center gap-1">
                            <FileText className="w-3 h-3 text-muted-foreground" />
                            Statistics
                          </h4>
                          <div className="border border-border rounded overflow-hidden text-[10px]">
                            {[
                              { key: 'search_results_count', label: 'Raw Results' },
                              { key: 'fetched_success_count', label: 'Fetches Succeeded' },
                              { key: 'chunks_created', label: 'Chunks Created' },
                              { key: 'chunks_retrieved', label: 'BM25 Candidates' },
                              { key: 'chunks_reranked', label: 'Neural Candidates' },
                              { key: 'sources_used_count', label: 'Sources In Context' },
                            ].map((item) => {
                              const value = metrics[item.key]
                              if (value === undefined) return null
                              return (
                                <div key={item.key} className="flex items-center justify-between p-1.5 border-b border-border last:border-0 bg-background/30">
                                  <span className="text-muted-foreground">{item.label}</span>
                                  <span className="font-semibold">{value}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
        </div>

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
                      className={cn(
                        "group p-3 rounded-lg border border-border/60 hover:bg-muted/40 hover:border-primary/20 cursor-pointer transition-all duration-200 relative flex flex-col justify-between gap-1.5 bg-card",
                        runId === run.id ? "bg-primary/5 border-primary/20 ring-1 ring-primary/10" : ""
                      )}
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
                          className={cn(
                            "text-[9px] font-normal uppercase py-0 px-1.5",
                            run.status === 'completed' ? "border-green-500/20 text-green-500 bg-green-500/5" :
                            run.status === 'failed' ? "border-red-500/20 text-red-500 bg-red-500/5" :
                            run.status === 'cancelled' ? "border-amber-500/20 text-amber-500 bg-amber-500/5" :
                            "border-blue-500/20 text-blue-500 bg-blue-500/5"
                          )}
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
