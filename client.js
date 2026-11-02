/**
 * dsh-memory-rag — 设置页（Web 客户端）。
 *
 * 纯手写客户端模块（无构建步骤）：React 由宿主模块加载器提供
 * （`require('react')`），页面注册进设置外壳声明的 `settings.section` 槽位。
 * 所有读写都走宿主 HTTP API（/dsh-memory-rag/api/*），密钥只写不读。
 * 文案随浏览器语言在中/英之间切换。
 */

window.__ModuleLoader__.load({
  id: 'dsh-memory-rag',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-memory-rag/api'

    const STRINGS = {
      zh: {
        nav: 'RAG 记忆',
        navInsights: '记忆洞察',
        insightsTitle: '记忆洞察',
        insightsSub: '本地记忆库的运行概况 · 不联网、不上传',
        range7: '近 7 天',
        range30: '近 30 天',
        range90: '近 90 天',
        kpiEntries: '总记忆',
        kpiNotes: '笔记',
        kpiFiles: '文档块',
        kpiProject: '项目记忆',
        kpiGlobal: '全局记忆',
        kpiPinned: '置顶',
        dailyCard: '每日新增',
        compositionCard: '构成',
        scopeCard: '作用域',
        tagsCard: '标签分布',
        recentCard: '最近写入',
        storageCard: '存储',
        emptyChart: '统计范围内暂无数据',
        updatedAt: '更新于',
        refresh: '刷新',
        loadFailedShort: '加载失败',
        loading: '加载中…',
        retry: '重试',
        loadFailed: '读取设置失败',
        endpoint: '服务地址',
        endpointHint: '任何 OpenAI 兼容的 embeddings 端点都可以；不同站点的 Key 不通用。',
        provider: '提供商',
        baseUrl: 'Base URL',
        currentEndpoint: '当前接口',
        key: 'API Key',
        configured: '已配置',
        notConfigured: '未配置',
        noKeyNeeded: '无需 Key',
        keywordHint: '本地关键词模式（BM25）：只在本机对文本建倒排索引，不下载模型、不联网、不需要 Key。',
        keywordTest: '关键词模式：无需连接。',
        statusTitle: '运行状况',
        mode: '模式',
        modeCloud: '云端嵌入',
        modeLocal: '本地模型（Ollama 等）',
        modeKeyword: '本地关键词（BM25）',
        health: '健康检查',
        healthy: '正常',
        lockHeld: '写锁被占用',
        storeError: '索引异常',
        storage: '存储',
        recent: '最近写入',
        tags: '标签分布',
        notes: '笔记',
        files: '文档块',
        pinnedCount: '置顶',
        projectCount: '项目',
        globalCount: '全局',
        autoRefresh: '自动刷新（10 秒）',
        refreshNow: '刷新状态',
        memoriesTitle: '记忆库',
        searchPlaceholder: '搜索记忆（关键词/原句）',
        search: '搜索',
        clearSearch: '清空',
        emptyMemories: '没有匹配的记忆',
        pin: '置顶',
        unpin: '取消置顶',
        delete: '删除',
        deleteConfirm: '确定删除这条记忆？',
        loadMore: '加载更多',
        sizeIndex: '索引文件',
        sizeMeta: '元数据',
        source: '来源',
        keyHint: 'Key 只写入本机数据目录的 api-key 文件，接口不回读，也不会进入对话日志。',
        replaceKey: '替换 Key',
        pasteKey: '粘贴 Key',
        saveKey: '保存 Key',
        savingKey: '保存中…',
        clear: '清除',
        test: '测试连接',
        testing: '测试中…',
        testOk: '连接正常',
        model: '向量模型',
        modelName: '模型',
        fetchModels: '拉取可用模型',
        fetching: '拉取中…',
        dimensions: '维度',
        modelHint: '记忆库非空时不允许换模型/维度（避免新旧向量混用）。',
        retrieval: '检索与注入',
        topK: '默认返回条数 (topK)',
        minScore: '最低相似度 (minScore)',
        minScoreHint: '0–1；越高越严格。',
        maxInject: '索引字符上限',
        inject: '在会话开始时注入「记忆索引」（本地渲染，不产生网络请求）',
        status: '运行状态',
        entries: '条目',
        dim: '维度',
        revision: 'revision',
        tokens: '本进程 tokens',
        tombstones: '墓碑',
        corrupt: '损坏行',
        save: '保存设置',
        saving: '保存中…',
        reload: '重新读取',
        saved: '设置已保存并立即生效。',
        savedKey: '已保存 Key，下一次检索/写入立即使用它。',
        clearedKey: '已清除 Key。',
        needKey: '请先粘贴 API Key。',
        empty: '没有可显示的设置。',
        saveFailed: '保存失败',
        keyFailed: '保存 Key 失败',
        clearFailed: '清除失败',
        testFailed: '测试失败',
        modelsOk: '可用模型',
        modelsEmpty: '端点没有返回模型列表',
        customModel: '模型名（自定义）',
        dimsCustom: '维度（自定义）',
      },
      en: {
        nav: 'RAG Memory',
        navInsights: 'Memory insights',
        insightsTitle: 'Memory insights',
        insightsSub: 'Local memory overview · no network, no upload',
        range7: '7 days',
        range30: '30 days',
        range90: '90 days',
        kpiEntries: 'Memories',
        kpiNotes: 'Notes',
        kpiFiles: 'Doc chunks',
        kpiProject: 'Project',
        kpiGlobal: 'Global',
        kpiPinned: 'Pinned',
        dailyCard: 'Daily additions',
        compositionCard: 'Composition',
        scopeCard: 'Scope',
        tagsCard: 'Tags',
        recentCard: 'Recent writes',
        storageCard: 'Storage',
        emptyChart: 'No data in range',
        updatedAt: 'Updated',
        refresh: 'Refresh',
        loadFailedShort: 'Failed to load',
        loading: 'Loading…',
        retry: 'Retry',
        loadFailed: 'Failed to load settings',
        endpoint: 'Endpoint',
        endpointHint: 'Any OpenAI-compatible embeddings endpoint works; API keys are not shared between providers.',
        provider: 'Provider',
        baseUrl: 'Base URL',
        currentEndpoint: 'Endpoint',
        key: 'API Key',
        configured: 'Configured',
        notConfigured: 'Not configured',
        noKeyNeeded: 'No key needed',
        keywordHint: 'Local keyword mode (BM25): an in-process inverted index over text. No model download, no network, no API key.',
        keywordTest: 'Keyword mode: no connection needed.',
        statusTitle: 'Status',
        mode: 'Mode',
        modeCloud: 'Cloud embeddings',
        modeLocal: 'Local model (Ollama etc.)',
        modeKeyword: 'Local keyword (BM25)',
        health: 'Health',
        healthy: 'OK',
        lockHeld: 'Write lock held',
        storeError: 'Index error',
        storage: 'Storage',
        recent: 'Recent writes',
        tags: 'Tags',
        notes: 'Notes',
        files: 'Document chunks',
        pinnedCount: 'Pinned',
        projectCount: 'Project',
        globalCount: 'Global',
        autoRefresh: 'Auto refresh (10s)',
        refreshNow: 'Refresh status',
        memoriesTitle: 'Memory browser',
        searchPlaceholder: 'Search memories (keyword or phrase)',
        search: 'Search',
        clearSearch: 'Clear',
        emptyMemories: 'No matching memories',
        pin: 'Pin',
        unpin: 'Unpin',
        delete: 'Delete',
        deleteConfirm: 'Delete this memory?',
        loadMore: 'Load more',
        sizeIndex: 'Index file',
        sizeMeta: 'Metadata',
        source: 'source',
        keyHint: 'The key is written only to the local api-key file; the API never reads it back and it never enters chat logs.',
        replaceKey: 'Replace key',
        pasteKey: 'Paste key',
        saveKey: 'Save key',
        savingKey: 'Saving…',
        clear: 'Clear',
        test: 'Test connection',
        testing: 'Testing…',
        testOk: 'Connection OK',
        model: 'Embedding model',
        modelName: 'Model',
        fetchModels: 'List models',
        fetching: 'Listing…',
        dimensions: 'Dimensions',
        modelHint: 'Changing model or dimensions is blocked while memory is non-empty (avoids mixing vector spaces).',
        retrieval: 'Retrieval and injection',
        topK: 'Default results (topK)',
        minScore: 'Minimum score',
        minScoreHint: '0–1; higher is stricter.',
        maxInject: 'Index character cap',
        inject: 'Inject the memory index at session start (rendered locally, no network)',
        status: 'Status',
        entries: 'Entries',
        dim: 'Dimensions',
        revision: 'revision',
        tokens: 'Process tokens',
        tombstones: 'Tombstones',
        corrupt: 'Corrupt lines',
        save: 'Save settings',
        saving: 'Saving…',
        reload: 'Reload',
        saved: 'Settings saved and applied immediately.',
        savedKey: 'Key saved; the next search/write uses it.',
        clearedKey: 'Key cleared.',
        needKey: 'Paste an API key first.',
        empty: 'Nothing to show.',
        saveFailed: 'Save failed',
        keyFailed: 'Saving key failed',
        clearFailed: 'Clearing failed',
        testFailed: 'Test failed',
        modelsOk: 'Models',
        modelsEmpty: 'The endpoint returned no model list',
        customModel: 'Model name (custom)',
        dimsCustom: 'Dimensions (custom)',
      },
    }

    const language = (() => {
      const nav = globalThis.navigator
      const raw = typeof nav?.language === 'string' ? nav.language : ''
      return raw.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    })()
    const t = STRINGS[language] ?? STRINGS.zh

    /**
     * 页面与 Host 同源时用相对路径；桌面壳以 dsh-app:// 加载页面时，
     * 宿主 HTTP origin 由 __DSH_TRANSPORT__.streamBaseUrl 提供。
     */
    function apiBase() {
      const location = globalThis.location
      if (location && (location.protocol === 'http:' || location.protocol === 'https:')) return ''
      const transport = globalThis.__DSH_TRANSPORT__
      const origin = transport && typeof transport.streamBaseUrl === 'string' ? transport.streamBaseUrl : ''
      return origin.replace(/\/+$/, '')
    }

    /** 依次尝试「宿主 origin」与「同源相对路径」，兼容浏览器页面与桌面壳。 */
    async function callApi(path, options) {
      const base = apiBase()
      const candidates = base === '' ? [''] : [base, '']
      let lastError = null
      for (const prefix of candidates) {
        try {
          return await callApiAt(prefix + API + path, options)
        } catch (error) {
          lastError = error
          // 只有网络级失败（CORS/连接失败）才换下一个候选；HTTP 业务错误直接抛出。
          if (!(error instanceof TypeError)) break
        }
      }
      throw lastError ?? new Error('request failed')
    }

    async function callApiAt(url, options) {
      const method = options?.method ?? 'GET'
      const response = await fetch(url, {
        method,
        headers: options?.body === undefined ? {} : { 'content-type': 'application/json' },
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
      })
      const text = await response.text()
      let payload = null
      try {
        payload = text === '' ? null : JSON.parse(text)
      } catch {
        payload = null
      }
      if (!response.ok) {
        const message = payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`
        throw new Error(message)
      }
      return payload ?? {}
    }

    const colors = {
      label: 'var(--dsw-alias-label-primary, #1f2329)',
      secondary: 'var(--dsw-alias-label-secondary, #646a73)',
      tertiary: 'var(--dsw-alias-label-tertiary, #8f959e)',
      border: 'var(--dsw-alias-border-l2, #dee0e3)',
      bg: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      bg2: 'var(--dsw-alias-bg-layer-2, #f5f6f7)',
      brand: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      error: 'var(--dsw-alias-state-error-primary, #d83931)',
      success: 'var(--dsw-alias-state-success-primary, #2ea121)',
    }

    const styles = {
      page: {
        display: 'flex', flexDirection: 'column', gap: '16px', color: colors.label,
        fontSize: '13px', lineHeight: '1.6', padding: '4px 2px 24px',
      },
      card: {
        border: `1px solid ${colors.border}`, borderRadius: '10px', background: colors.bg,
        padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px',
      },
      title: { fontSize: '13px', fontWeight: 650, margin: 0 },
      hint: { color: colors.secondary, fontSize: '12px', margin: 0 },
      row: { display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px', flex: '1 1 200px' },
      fieldLabel: { fontSize: '12px', color: colors.secondary },
      input: {
        font: 'inherit', fontSize: '13px', color: colors.label, background: colors.bg2,
        border: `1px solid ${colors.border}`, borderRadius: '7px', padding: '6px 9px',
        outline: 'none', minWidth: 0, width: '100%', boxSizing: 'border-box',
      },
      select: {
        font: 'inherit', fontSize: '13px', color: colors.label, background: colors.bg2,
        border: `1px solid ${colors.border}`, borderRadius: '7px', padding: '6px 9px',
        outline: 'none', width: '100%', boxSizing: 'border-box',
      },
      button: {
        font: 'inherit', fontSize: '12.5px', color: colors.label, background: colors.bg2,
        border: `1px solid ${colors.border}`, borderRadius: '7px', padding: '5px 12px', cursor: 'pointer',
      },
      primary: {
        font: 'inherit', fontSize: '12.5px', color: '#fff', background: colors.brand,
        border: '1px solid transparent', borderRadius: '7px', padding: '5px 14px', cursor: 'pointer',
      },
      danger: {
        font: 'inherit', fontSize: '12.5px', color: colors.error, background: 'transparent',
        border: `1px solid ${colors.border}`, borderRadius: '7px', padding: '5px 12px', cursor: 'pointer',
      },
      note: (kind) => ({
        fontSize: '12px',
        color: kind === 'error' ? colors.error : kind === 'ok' ? colors.success : colors.secondary,
        margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
      }),
      statGrid: {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
        gap: '6px 18px', fontSize: '12px', color: colors.secondary,
      },
      mono: { fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)' },
      pill: (on) => ({
        display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px',
        color: on ? colors.success : colors.tertiary,
        border: `1px solid ${on ? colors.success : colors.border}`,
        borderRadius: '999px', padding: '1px 9px',
      }),
      insights: {
        display: 'flex', flexDirection: 'column', gap: '16px',
        padding: '20px 24px 32px', height: '100%', overflowY: 'auto', boxSizing: 'border-box',
      },
      insightsTitle: { fontSize: '22px', fontWeight: 650, margin: 0, letterSpacing: '0.5px' },
      insightsSub: { fontSize: '12px', color: colors.secondary, margin: '4px 0 0' },
      range: {
        font: 'inherit', fontSize: '12px', color: colors.secondary, background: 'transparent',
        border: 'none', borderRadius: '999px', padding: '4px 10px', cursor: 'pointer',
      },
      rangeOn: { color: '#fff', background: colors.brand },
      tileGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' },
      tile: {
        background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: '12px',
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '2px',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
      },
      tileLabel: { fontSize: '12px', color: colors.secondary },
      tileValue: { fontSize: '24px', fontWeight: 650, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' },
      tileSub: { fontSize: '11px', color: colors.tertiary },
      twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' },
      cardTitle: { fontSize: '13px', fontWeight: 650, margin: 0 },
      bars: { display: 'flex', alignItems: 'flex-end', gap: '2px', height: '120px' },
      axis: { display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: colors.tertiary, marginTop: '4px' },
    }

    function Field(props) {
      return h('div', { style: styles.field },
        h('label', { htmlFor: props.htmlFor, style: styles.fieldLabel }, props.label),
        props.children,
        props.hint ? h('span', { style: { fontSize: '11px', color: colors.tertiary } }, props.hint) : null)
    }

    function Section() {
      const [loading, setLoading] = React.useState(true)
      const [loadError, setLoadError] = React.useState(null)
      const [data, setData] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [keyInput, setKeyInput] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [testResult, setTestResult] = React.useState(null)
      const [remoteModels, setRemoteModels] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [statusError, setStatusError] = React.useState(null)
      const [autoRefresh, setAutoRefresh] = React.useState(true)
      const [memories, setMemories] = React.useState({ items: [], total: 0, nextOffset: null })
      const [memQuery, setMemQuery] = React.useState('')
      const [memBusy, setMemBusy] = React.useState('')
      const ids = {
        provider: React.useId(),
        baseUrl: React.useId(),
        model: React.useId(),
        dims: React.useId(),
        key: React.useId(),
        topK: React.useId(),
        minScore: React.useId(),
        maxInject: React.useId(),
        memSearch: React.useId(),
      }

      const load = React.useCallback(async () => {
        setLoadError(null)
        try {
          const snapshot = await callApi('/settings')
          setData(snapshot)
          setForm({ ...snapshot.settings })
        } catch (error) {
          setLoadError(String(error?.message ?? error))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const loadStatus = React.useCallback(async () => {
        try {
          const snapshot = await callApi('/status')
          setStatus(snapshot)
          setStatusError(null)
        } catch (error) {
          setStatusError(String(error?.message ?? error))
        }
      }, [])

      const loadMemories = React.useCallback(async (options = {}) => {
        const offset = options.offset ?? 0
        const query = options.query ?? ''
        setMemBusy('list')
        try {
          const page = await callApi(`/memories?query=${encodeURIComponent(query)}&limit=20&offset=${offset}`)
          setMemories((current) => ({
            items: offset === 0 ? page.items : [...current.items, ...page.items],
            total: page.total,
            nextOffset: page.nextOffset,
          }))
        } catch (error) {
          setNotice({ kind: 'error', text: `${t.memoriesTitle}: ${error?.message ?? error}` })
        } finally {
          setMemBusy('')
        }
      }, [])

      React.useEffect(() => { loadStatus() }, [loadStatus])
      React.useEffect(() => { loadMemories({}) }, [loadMemories])
      React.useEffect(() => {
        if (!autoRefresh) return undefined
        const timer = setInterval(() => { loadStatus() }, 10000)
        return () => clearInterval(timer)
      }, [autoRefresh, loadStatus])

      const changeEntry = async (id, action) => {
        if (action === 'delete' && !globalThis.confirm(t.deleteConfirm)) return
        setMemBusy(id)
        try {
          await callApi('/memories/update', { method: 'POST', body: { id, action } })
          await Promise.all([loadMemories({ query: memQuery }), loadStatus(), load()])
        } catch (error) {
          setNotice({ kind: 'error', text: `${t.memoriesTitle}: ${error?.message ?? error}` })
        } finally {
          setMemBusy('')
        }
      }

      const update = (key, value) => {
        setForm((current) => (current === null ? current : { ...current, [key]: value }))
      }

      const save = async () => {
        if (form === null) return
        setBusy('save')
        setNotice(null)
        try {
          const result = await callApi('/settings', {
            method: 'POST',
            body: {
              provider: form.provider,
              baseUrl: form.baseUrl,
              embeddingModel: form.provider === 'keyword' ? 'bm25' : form.embeddingModel,
              dimensions: form.provider === 'keyword' ? 0 : Number(form.dimensions),
              topK: Number(form.topK),
              minScore: Number(form.minScore),
              injectIndex: form.injectIndex === true,
              maxInjectChars: Number(form.maxInjectChars),
            },
          })
          setData((current) => ({ ...current, settings: result.settings, key: result.key ?? current.key }))
          setForm({ ...result.settings })
          setNotice({ kind: 'ok', text: t.saved })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t.saveFailed}: ${error?.message ?? error}` })
        } finally {
          setBusy('')
        }
      }

      const saveKey = async () => {
        const key = keyInput.trim()
        if (key === '') {
          setNotice({ kind: 'error', text: t.needKey })
          return
        }
        setBusy('key')
        setNotice(null)
        try {
          const result = await callApi('/key', { method: 'POST', body: { key } })
          setData((current) => ({ ...current, key: result.key }))
          setKeyInput('')
          setNotice({ kind: 'ok', text: t.savedKey })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t.keyFailed}: ${error?.message ?? error}` })
        } finally {
          setBusy('')
        }
      }

      const clearKey = async () => {
        setBusy('key')
        setNotice(null)
        try {
          const result = await callApi('/key', { method: 'DELETE' })
          setData((current) => ({ ...current, key: result.key }))
          setNotice({ kind: 'ok', text: t.clearedKey })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t.clearFailed}: ${error?.message ?? error}` })
        } finally {
          setBusy('')
        }
      }

      const test = async () => {
        setBusy('test')
        setNotice(null)
        setTestResult(null)
        try {
          const result = await callApi('/test', { method: 'POST', body: {} })
          setTestResult(result.result)
          setData((current) => ({ ...current, key: result.key ?? current.key }))
        } catch (error) {
          setNotice({ kind: 'error', text: `${t.testFailed}: ${error?.message ?? error}` })
        } finally {
          setBusy('')
        }
      }

      const fetchModels = async () => {
        setBusy('models')
        setNotice(null)
        try {
          const result = await callApi('/models')
          setRemoteModels(Array.isArray(result.models) ? result.models : [])
          if (!Array.isArray(result.models) || result.models.length === 0) {
            setNotice({ kind: 'error', text: t.modelsEmpty })
          }
        } catch (error) {
          setNotice({ kind: 'error', text: `${t.fetchModels}: ${error?.message ?? error}` })
        } finally {
          setBusy('')
        }
      }

      if (loading) return h('div', { style: styles.page }, t.loading)
      if (loadError !== null) {
        return h('div', { style: styles.page },
          h('p', { style: styles.note('error') }, `${t.loadFailed}: ${loadError}`),
          h('div', null, h('button', { type: 'button', style: styles.button, onClick: load }, t.retry)))
      }
      if (form === null || data === null) return h('div', { style: styles.page }, t.empty)

      const providers = Array.isArray(data.providers) ? data.providers : []
      const currentProvider = providers.find((item) => item.id === form.provider)
      const keywordMode = form.provider === 'keyword'
      const providerModels = currentProvider?.models ?? {}
      const modelOptions = Object.keys(providerModels)
      const dimensionOptions = providerModels[form.embeddingModel] ?? []
      const key = data.key ?? { configured: false }
      const stats = data.stats ?? {}

      const changeProvider = (providerId) => {
        const preset = providers.find((item) => item.id === providerId)
        if (preset === undefined) {
          update('provider', providerId)
          return
        }
        if (providerId === 'keyword') {
          setForm((current) => ({
            ...current,
            provider: providerId,
            baseUrl: '',
            apiKeyEnv: preset.apiKeyEnv,
            embeddingModel: 'bm25',
            dimensions: 0,
          }))
          return
        }
        const models = Object.keys(preset.models)
        const model = models[0] ?? form.embeddingModel
        const dims = preset.models[model] ?? dimensionOptions
        const preferred = dims.includes(1024) ? 1024 : (dims[0] ?? form.dimensions)
        setForm((current) => ({
          ...current,
          provider: providerId,
          baseUrl: preset.baseUrl,
          apiKeyEnv: preset.apiKeyEnv,
          embeddingModel: model,
          dimensions: preferred,
        }))
      }

      const changeModel = (model) => {
        const allowed = providerModels[model] ?? []
        update('embeddingModel', model)
        if (allowed.length > 0 && !allowed.includes(Number(form.dimensions))) {
          update('dimensions', allowed.includes(1024) ? 1024 : allowed[0])
        }
      }

      return h('div', { style: styles.page },

        h('section', { style: styles.card },
          h('h3', { style: styles.title }, t.endpoint),
          h('p', { style: styles.hint }, t.endpointHint),
          h('div', { style: styles.row },
            h(Field, { label: t.provider, htmlFor: ids.provider },
              h('select', {
                id: ids.provider,
                style: styles.select,
                value: form.provider,
                onChange: (event) => changeProvider(event.target.value),
              }, providers.map((item) => h('option', { key: item.id, value: item.id }, item.label)))),
            keywordMode
              ? h('p', { style: { ...styles.hint, flex: '1 1 240px', alignSelf: 'center' } }, t.keywordHint)
              : h(Field, { label: t.baseUrl, htmlFor: ids.baseUrl },
                h('input', {
                  id: ids.baseUrl,
                  style: styles.input,
                  type: 'text',
                  spellCheck: false,
                  value: form.baseUrl,
                  onChange: (event) => update('baseUrl', event.target.value),
                }))),
          keywordMode
            ? null
            : h('p', { style: styles.hint }, `${t.currentEndpoint}: ${form.baseUrl}/embeddings`)),

        h('section', { style: styles.card },
          h('h3', { style: styles.title }, t.key),
          h('div', { style: styles.row },
            h('span', { style: styles.pill(key.configured === true) },
              key.configured === true
                ? t.configured
                : (keywordMode || currentProvider?.keyOptional === true) ? t.noKeyNeeded : t.notConfigured),
            key.configured === true && key.source
              ? h('span', { style: { fontSize: '11.5px', color: colors.tertiary, alignSelf: 'center' } }, `${t.source}: ${key.source}`)
              : null),
          h('p', { style: styles.hint }, t.keyHint),
          h('div', { style: { ...styles.row, alignItems: 'flex-end' } },
            h(Field, { label: key.configured === true ? t.replaceKey : t.pasteKey, htmlFor: ids.key },
              h('input', {
                id: ids.key,
                style: styles.input,
                type: 'password',
                autoComplete: 'off',
                placeholder: keywordMode ? t.noKeyNeeded : 'sk-…',
                value: keyInput,
                onChange: (event) => setKeyInput(event.target.value),
              })),
            h('button', { type: 'button', style: styles.primary, disabled: busy !== '', onClick: saveKey },
              busy === 'key' ? t.savingKey : t.saveKey),
            key.configured === true
              ? h('button', { type: 'button', style: styles.danger, disabled: busy !== '', onClick: clearKey }, t.clear)
              : null),
          h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
            h('button', { type: 'button', style: styles.button, disabled: busy !== '', onClick: test },
              busy === 'test' ? t.testing : t.test),
            testResult !== null
              ? h('span', { style: styles.note('ok') },
                testResult.mode === 'keyword'
                  ? t.keywordTest
                  : `${t.testOk}: ${testResult.model} / ${testResult.dimensions} dim / ${testResult.tokens} tokens / ${testResult.latencyMs}ms`)
              : null)),

        h('section', { style: styles.card },
          h('h3', { style: styles.title }, t.model),
          keywordMode
            ? h('p', { style: styles.hint }, t.keywordHint)
            : h('div', { style: styles.row },
            h(Field, { label: t.modelName, htmlFor: ids.model },
              modelOptions.length > 0
                ? h('select', {
                  id: ids.model,
                  style: styles.select,
                  value: form.embeddingModel,
                  onChange: (event) => changeModel(event.target.value),
                }, modelOptions.map((model) => h('option', { key: model, value: model }, model)))
                : h('input', {
                  id: ids.model,
                  style: styles.input,
                  type: 'text',
                  spellCheck: false,
                  value: form.embeddingModel,
                  onChange: (event) => update('embeddingModel', event.target.value),
                })),
            h(Field, { label: t.dimensions, htmlFor: ids.dims, hint: t.modelHint },
              dimensionOptions.length > 0
                ? h('select', {
                  id: ids.dims,
                  style: styles.select,
                  value: String(form.dimensions),
                  onChange: (event) => update('dimensions', Number(event.target.value)),
                }, dimensionOptions.map((dim) => h('option', { key: dim, value: String(dim) }, `${dim}`)))
                : h('input', {
                  id: ids.dims,
                  style: styles.input,
                  type: 'number',
                  min: 8,
                  max: 8192,
                  value: form.dimensions,
                  onChange: (event) => update('dimensions', Number(event.target.value)),
                }))),
          keywordMode
            ? null
            : h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
              h('button', { type: 'button', style: styles.button, disabled: busy !== '', onClick: fetchModels },
                busy === 'models' ? t.fetching : t.fetchModels),
              remoteModels !== null && remoteModels.length > 0
                ? h('select', {
                  style: { ...styles.select, maxWidth: '320px' },
                  value: '',
                  onChange: (event) => {
                    if (event.target.value !== '') changeModel(event.target.value)
                  },
                }, h('option', { value: '' }, `${t.modelsOk} (${remoteModels.length})`),
                remoteModels.map((model) => h('option', { key: model, value: model }, model)))
                : null)),

        h('section', { style: styles.card },
          h('h3', { style: styles.title }, t.retrieval),
          h('div', { style: styles.row },
            h(Field, { label: t.topK, htmlFor: ids.topK },
              h('input', {
                id: ids.topK, style: styles.input, type: 'number', min: 1, max: 50,
                value: form.topK,
                onChange: (event) => update('topK', Number(event.target.value)),
              })),
            keywordMode
              ? null
              : h(Field, { label: t.minScore, htmlFor: ids.minScore, hint: t.minScoreHint },
                h('input', {
                  id: ids.minScore, style: styles.input, type: 'number', min: 0, max: 1, step: 0.05,
                  value: form.minScore,
                  onChange: (event) => update('minScore', Number(event.target.value)),
                })),
            h(Field, { label: t.maxInject, htmlFor: ids.maxInject },
              h('input', {
                id: ids.maxInject, style: styles.input, type: 'number', min: 200, max: 20000, step: 100,
                value: form.maxInjectChars,
                onChange: (event) => update('maxInjectChars', Number(event.target.value)),
              }))),
          h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12.5px' } },
            h('input', {
              type: 'checkbox',
              checked: form.injectIndex === true,
              onChange: (event) => update('injectIndex', event.target.checked),
            }),
            t.inject)),

        h('section', { style: styles.card },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
            h('h3', { style: styles.title }, t.statusTitle),
            h('span', { style: styles.pill(status !== null && statusError === null && status.health?.storeLoaded === true) },
              statusError !== null ? t.storeError : (status === null ? '…' : t.healthy)),
            h('span', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' } },
              h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', color: colors.secondary } },
                h('input', {
                  type: 'checkbox',
                  checked: autoRefresh,
                  onChange: (event) => setAutoRefresh(event.target.checked),
                }),
                t.autoRefresh),
              h('button', {
                type: 'button',
                style: styles.button,
                onClick: () => { loadStatus(); loadMemories({ query: memQuery }) },
              }, t.refreshNow))),
          statusError !== null ? h('p', { style: styles.note('error') }, statusError) : null,
          status === null
            ? null
            : h('div', { style: styles.statGrid },
              h('span', null, `${t.mode}: ${status.mode === 'keyword' ? t.modeKeyword : status.mode === 'local' ? t.modeLocal : t.modeCloud}`),
              status.baseUrl ? h('span', null, `Endpoint: ${status.baseUrl}`) : null,
              h('span', null, `Model: ${status.model}${status.dimensions > 0 ? ` / ${status.dimensions} dim` : ''}`),
              h('span', null, `${t.entries}: ${status.stats.count}`),
              h('span', null, `${t.notes}: ${status.breakdown.notes} · ${t.files}: ${status.breakdown.files}`),
              h('span', null, `${t.projectCount}: ${status.breakdown.project} · ${t.globalCount}: ${status.breakdown.global}`),
              h('span', null, `${t.pinnedCount}: ${status.breakdown.pinned}`),
              h('span', null, `${t.tokens}: ${status.usage.tokens}`),
              h('span', null, `revision: ${status.stats.revision}`),
              h('span', null, `${t.lockHeld}: ${status.health.lockHeld ? '⏳' : '—'}`)),
          status === null
            ? null
            : h('p', { style: { ...styles.hint, ...styles.mono, overflowWrap: 'anywhere' } }, status.stats.dir),
          status === null
            ? null
            : h('p', { style: styles.hint },
              `${t.storage}: ${t.sizeIndex} ${(status.storage.indexBytes / 1024).toFixed(1)} KB · ${t.sizeMeta} ${(status.storage.metaBytes / 1024).toFixed(1)} KB`),
          status !== null && status.tags.length > 0
            ? h('p', { style: styles.hint }, `${t.tags}: ${status.tags.map((item) => `#${item.tag}(${item.count})`).join('  ')}`)
            : null,
          status !== null && status.recent.length > 0
            ? h('div', null,
              h('p', { style: { ...styles.hint, margin: '4px 0 2px' } }, t.recent),
              status.recent.map((item) => h('div', {
                key: item.id,
                style: { fontSize: '12px', color: colors.secondary, padding: '1px 0' },
              }, `- [${item.id}] ${item.title} · ${item.scopeKind === 'project' ? t.projectCount : t.globalCount} · ${item.createdAt ?? ''}`)))
            : null),

        h('section', { style: styles.card },
          h('h3', { style: styles.title }, `${t.memoriesTitle} (${memories.total})`),
          h('div', { style: styles.row },
            h(Field, { label: t.searchPlaceholder, htmlFor: ids.memSearch },
              h('input', {
                id: ids.memSearch,
                style: styles.input,
                type: 'search',
                value: memQuery,
                onChange: (event) => setMemQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') loadMemories({ query: memQuery })
                },
              })),
            h('button', {
              type: 'button',
              style: styles.primary,
              disabled: memBusy === 'list',
              onClick: () => loadMemories({ query: memQuery }),
            }, memBusy === 'list' ? '…' : t.search),
            memQuery !== ''
              ? h('button', {
                type: 'button',
                style: styles.button,
                onClick: () => { setMemQuery(''); loadMemories({ query: '' }) },
              }, t.clearSearch)
              : null),
          memories.items.length === 0
            ? h('p', { style: styles.hint }, t.emptyMemories)
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
              memories.items.map((item) => h('div', {
                key: item.id,
                style: { borderTop: `1px solid ${colors.border}`, paddingTop: '6px' },
              },
              h('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } },
                h('span', { style: { fontWeight: 600 } }, item.title),
                h('span', { style: { fontSize: '11px', color: colors.tertiary } },
                  `[${item.id}] ${item.scopeKind === 'project' ? t.projectCount : t.globalCount} · ${item.source} · ${item.createdAt ?? ''}`),
                h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
                  h('button', {
                    type: 'button',
                    style: styles.button,
                    disabled: memBusy !== '',
                    onClick: () => changeEntry(item.id, item.pinned ? 'unpin' : 'pin'),
                  }, item.pinned ? t.unpin : t.pin),
                  h('button', {
                    type: 'button',
                    style: styles.danger,
                    disabled: memBusy !== '',
                    onClick: () => changeEntry(item.id, 'delete'),
                  }, t.delete))),
              h('p', { style: { ...styles.hint, margin: '2px 0 0' } }, item.preview)))),
          memories.nextOffset !== null
            ? h('button', {
              type: 'button',
              style: styles.button,
              disabled: memBusy === 'list',
              onClick: () => loadMemories({ query: memQuery, offset: memories.nextOffset }),
            }, t.loadMore)
            : null),

        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
          h('button', { type: 'button', style: styles.primary, disabled: busy !== '', onClick: save },
            busy === 'save' ? t.saving : t.save),
          h('button', { type: 'button', style: styles.button, disabled: busy !== '', onClick: load }, t.reload),
          notice !== null ? h('span', { style: styles.note(notice.kind) }, notice.text) : null))
    }

    const PANEL_ID = 'rag-memory-insights'

    const accent = {
      blue: '#4d6bfe',
      green: '#2ea121',
      purple: '#a855f7',
      orange: '#f59e0b',
      teal: '#14b8a6',
      red: '#d83931',
      track: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #646a73) 14%, transparent)',
    }

    function PanelIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: { display: 'block' },
      },
      h('rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 3.5 }),
      h('path', { d: 'M8 8.5h8M8 12h8M8 15.5h5' }))
    }

    function Tile(props) {
      return h('div', { style: styles.tile },
        h('div', { style: styles.tileLabel }, props.label),
        h('div', { style: styles.tileValue }, String(props.value)),
        props.sub ? h('div', { style: styles.tileSub }, props.sub) : null)
    }

    function percent(part, total) {
      if (!total) return 0
      return Math.round((part / total) * 100)
    }

    function Dashboard() {
      const [days, setDays] = React.useState(30)
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async (range) => {
        const target = range ?? days
        setBusy(true)
        try {
          const snapshot = await callApi(`/dashboard?days=${target}`)
          setData(snapshot)
          setError(null)
        } catch (fetchError) {
          setError(String(fetchError?.message ?? fetchError))
        } finally {
          setBusy(false)
        }
      }, [days])

      React.useEffect(() => { load(days) }, [days, load])

      const overview = data?.overview ?? {}
      const daily = data?.daily ?? []
      const heatmap = data?.heatmap ?? []
      const maxDaily = Math.max(1, ...daily.map((item) => item.count))
      const composition = data?.composition ?? []
      const compositionTotal = composition.reduce((sum, item) => sum + item.count, 0) || 1
      const scope = data?.scope ?? []
      const scopeTotal = scope.reduce((sum, item) => sum + item.count, 0) || 1
      const tags = data?.tags ?? []
      const maxTag = Math.max(1, ...tags.map((item) => item.count))
      const recent = data?.recent ?? []
      const storage = data?.storage ?? {}
      const maxHeat = Math.max(1, ...heatmap.map((item) => item.count))
      const notesPct = percent(composition.find((item) => item.id === 'notes')?.count ?? 0, compositionTotal)

      const donut = `conic-gradient(${accent.blue} 0 ${notesPct}%, ${accent.green} ${notesPct}% 100%)`

      return h('div', { style: styles.insights },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } },
          h('div', null,
            h('h2', { style: styles.insightsTitle }, t.insightsTitle),
            h('p', { style: styles.insightsSub }, t.insightsSub)),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' } },
            [7, 30, 90].map((range) => h('button', {
              key: range,
              type: 'button',
              onClick: () => setDays(range),
              style: {
                ...styles.range,
                ...(days === range ? styles.rangeOn : {}),
              },
            }, range === 7 ? t.range7 : range === 30 ? t.range30 : t.range90)),
            h('button', {
              type: 'button',
              style: styles.button,
              disabled: busy,
              onClick: () => load(days),
            }, busy ? '…' : t.refresh))),

        error !== null
          ? h('div', { style: styles.card }, h('p', { style: styles.note('error') }, `${t.loadFailedShort}: ${error}`))
          : null,

        h('div', { style: styles.tileGrid },
          h(Tile, { label: t.kpiEntries, value: overview.entries ?? 0, sub: `≈${Math.round((overview.chars ?? 0) / 1000)}k chars` }),
          h(Tile, { label: t.kpiNotes, value: overview.notes ?? 0, sub: `${notesPct}%` }),
          h(Tile, { label: t.kpiFiles, value: overview.files ?? 0, sub: `${overview.fileGroups ?? 0} files` }),
          h(Tile, { label: t.kpiProject, value: overview.project ?? 0, sub: `${percent(overview.project ?? 0, overview.entries ?? 0)}%` }),
          h(Tile, { label: t.kpiGlobal, value: overview.global ?? 0, sub: `${percent(overview.global ?? 0, overview.entries ?? 0)}%` }),
          h(Tile, { label: t.kpiPinned, value: overview.pinned ?? 0 })),

        h('div', { style: styles.twoCol },
          h('section', { style: styles.card },
            h('h3', { style: styles.cardTitle }, `${t.dailyCard} · ${days}d`),
            daily.every((item) => item.count === 0)
              ? h('p', { style: styles.hint }, t.emptyChart)
              : h('div', { style: styles.bars },
                daily.map((item) => h('div', {
                  key: item.date,
                  title: `${item.date}: ${item.count}`,
                  style: {
                    flex: '1 1 0',
                    minWidth: '2px',
                    height: `${Math.max(3, Math.round((item.count / maxDaily) * 100))}%`,
                    background: item.count > 0 ? accent.blue : accent.track,
                    borderRadius: '3px 3px 0 0',
                  },
                }))),
            h('div', { style: styles.axis },
              h('span', null, daily[0]?.date ?? ''),
              h('span', null, daily[daily.length - 1]?.date ?? ''))),

          h('section', { style: styles.card },
            h('h3', { style: styles.cardTitle }, t.compositionCard),
            h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' } },
              h('div', { style: { width: '120px', height: '120px', borderRadius: '50%', background: donut, position: 'relative', flex: 'none' } },
                h('div', {
                  style: {
                    position: 'absolute', inset: '18px', borderRadius: '50%',
                    background: 'var(--dsw-alias-bg-layer-1, #fff)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: '2px',
                  },
                },
                h('span', { style: { fontSize: '20px', fontWeight: 650 } }, String(compositionTotal)),
                h('span', { style: { fontSize: '11px', color: colors.tertiary } }, t.kpiEntries))),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '140px' } },
                composition.map((item, index) => h('div', {
                  key: item.id,
                  style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' },
                },
                h('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: index === 0 ? accent.blue : accent.green, flex: 'none' } }),
                h('span', null, item.label),
                h('span', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: colors.secondary } },
                  `${item.count} · ${percent(item.count, compositionTotal)}%`))))))

        ),

        h('div', { style: styles.twoCol },
          h('section', { style: styles.card },
            h('h3', { style: styles.cardTitle }, t.scopeCard),
            scope.map((item) => h('div', { key: item.id, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px' } },
                h('span', null, item.id === 'project' ? t.kpiProject : t.kpiGlobal),
                h('span', { style: { color: colors.secondary, fontVariantNumeric: 'tabular-nums' } },
                  `${item.count} · ${percent(item.count, scopeTotal)}%`)),
              h('div', { style: { height: '8px', borderRadius: '4px', background: accent.track, overflow: 'hidden' } },
                h('div', {
                  style: {
                    width: `${percent(item.count, scopeTotal)}%`,
                    height: '100%',
                    background: item.id === 'project' ? accent.purple : accent.teal,
                    borderRadius: '4px',
                  },
                }))))),

          h('section', { style: styles.card },
            h('h3', { style: styles.cardTitle }, t.tagsCard),
            tags.length === 0
              ? h('p', { style: styles.hint }, t.emptyChart)
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px' } },
                tags.map((item) => h('div', { key: item.tag, style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' } },
                  h('span', { style: { width: '84px', flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `#${item.tag}`),
                  h('div', { style: { flex: 1, height: '7px', borderRadius: '4px', background: accent.track, overflow: 'hidden' } },
                    h('div', {
                      style: { width: `${Math.max(4, Math.round((item.count / maxTag) * 100))}%`, height: '100%', background: accent.orange, borderRadius: '4px' },
                    })),
                  h('span', { style: { color: colors.secondary, fontVariantNumeric: 'tabular-nums', width: '28px', textAlign: 'right' } }, String(item.count))))))
        ),

        h('div', { style: styles.twoCol },
          h('section', { style: styles.card },
            h('h3', { style: styles.cardTitle }, t.recentCard),
            recent.length === 0
              ? h('p', { style: styles.hint }, t.emptyChart)
              : h('div', { style: { display: 'flex', flexDirection: 'column' } },
                recent.map((item) => h('div', {
                  key: item.id,
                  style: { borderTop: `1px solid ${colors.border}`, padding: '7px 0', display: 'flex', flexDirection: 'column', gap: '2px' },
                },
                h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
                  h('span', { style: { fontWeight: 600, fontSize: '12.5px' } }, item.title),
                  h('span', { style: { marginLeft: 'auto', fontSize: '11px', color: colors.tertiary } }, String(item.createdAt ?? '').slice(0, 10))),
                h('span', { style: { fontSize: '11.5px', color: colors.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.preview))))),

          h('section', { style: styles.card },
            h('h3', { style: styles.cardTitle }, t.storageCard),
            [[t.sizeIndex, storage.indexBytes], [t.sizeMeta, storage.metaBytes], ['settings.json', storage.settingsBytes], ['api-key', storage.keyBytes]]
              .map(([label, bytes]) => h('div', {
                key: label,
                style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0' },
              },
              h('span', { style: { color: colors.secondary } }, String(label)),
              h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, `${((Number(bytes) || 0) / 1024).toFixed(1)} KB`))),
            h('div', { style: { borderTop: `1px solid ${colors.border}`, marginTop: '6px', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600 } },
              h('span', null, 'Total'),
              h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, `${((Number(storage.totalBytes) || 0) / 1024).toFixed(1)} KB`)),
            h('p', { style: { ...styles.hint, ...styles.mono, marginTop: '8px', overflowWrap: 'anywhere' } }, storage.dir ?? ''),
            h('p', { style: styles.hint },
              `${t.updatedAt}: ${String(data?.generatedAt ?? '').replace('T', ' ').slice(0, 19)} · revision ${data?.launcher?.revision ?? '-'}`))),

        h('section', { style: styles.card },
          h('h3', { style: styles.cardTitle }, '活跃度'),
          h('div', { style: { display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 12px)', gap: '3px' } },
            heatmap.map((item) => h('div', {
              key: item.date,
              title: `${item.date}: ${item.count}`,
              style: {
                width: '12px',
                height: '12px',
                borderRadius: '2px',
                background: item.count === 0
                  ? accent.track
                  : `color-mix(in srgb, ${accent.blue} ${Math.min(100, 25 + Math.round((item.count / maxHeat) * 75))}%, transparent)`,
              },
            }))))
      )
    }

    return {
      inject: ['slots'],
      apply(clientCtx) {
        clientCtx.slots.inject('settings.section', () => clientCtx.slots.register({
          name: 'settings.section',
          id: 'rag-memory',
          order: 30,
          label: () => t.nav,
        }, Section))

        // 一级侧栏面板：图标注册在 sidebar.panellist，页面注册在同 id 的 main keyed slot。
        clientCtx.slots.inject('sidebar.panellist', () => clientCtx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          label: () => t.navInsights,
        }, (props) => h(PanelIcon, props)))

        clientCtx.slots.inject('main', () => clientCtx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Dashboard))
      },
    }
  },
})
