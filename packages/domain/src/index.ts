export type ConnectionProtocol = "ws" | "wss" | "http" | "https";
export type GremlinClientMode = "sessionless" | "sessioned";
export type ConnectionEnvironment = "dev" | "test" | "prod";
export type ConnectionProxyMode = "direct" | "system" | "manual";
export type ConnectionSshAuthMode = "password" | "private-key" | "agent";
export type AuthenticationProfileMode = "basic" | "janus-hmac" | "bearer" | "custom-headers";

export type AuthenticationProfile = {
  id: string;
  name: string;
  mode: AuthenticationProfileMode;
  username: string;
  headerName: string;
  hasSecret: boolean;
  hasSensitiveHeaders: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SaveAuthenticationProfileInput = {
  id?: string;
  name: string;
  mode: AuthenticationProfileMode;
  username: string;
  headerName: string;
  secret?: string;
  sensitiveHeaders?: string;
};

export type RuntimeAuthentication = {
  mode: AuthenticationProfileMode;
  username: string;
  secret: string;
  headerName: string;
  headers: Record<string, string>;
};

export type ConnectionProfile = {
  id: string;
  name: string;
  protocol: ConnectionProtocol;
  host: string;
  port: number;
  path: string;
  username: string;
  environment: ConnectionEnvironment;
  connectionReadOnly: boolean;
  clientMode: GremlinClientMode;
  traversalSource: string;
  graphBinding: string;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  tlsRejectUnauthorized: boolean;
  tlsCaPath: string;
  tlsClientCertPath: string;
  tlsClientKeyPath: string;
  proxyMode: ConnectionProxyMode;
  proxyUrl: string;
  proxyHost: string;
  proxyPort: number;
  proxyBypass: string;
  proxyUsername: string;
  authProfileId: string;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthMode: ConnectionSshAuthMode;
  sshPrivateKeyPath: string;
  sshAgentPath: string;
  sshHostKeyFingerprint: string;
  enableCompression: boolean;
  customHeaders: string;
  groupName?: string;
  accentColor?: string;
  tags?: string[];
  lastUsedAt?: string;
  lastTestedAt?: string;
  lastTestStatus?: "passed" | "failed";
  lastTestLatencyMs?: number;
  lastTestStage?: ConnectionTestStage;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionSshTunnelSnapshot = {
  status: "inactive" | "connecting" | "connected" | "disconnected" | "reconnecting" | "failed";
  localPort?: number;
  reconnectCount?: number;
  connectedAt?: string;
  disconnectedAt?: string;
  lastError?: string;
};

export type ConnectionSummary = ConnectionProfile & {
  hasPassword: boolean;
  hasTlsClientKeyPassphrase: boolean;
  hasProxyPassword: boolean;
  hasSensitiveHeaders: boolean;
  hasSshPassword: boolean;
  hasSshPrivateKeyPassphrase: boolean;
  sshTunnel?: ConnectionSshTunnelSnapshot;
};

export type SaveConnectionInput = Omit<
  ConnectionProfile,
  "id" | "createdAt" | "updatedAt" | "lastUsedAt" | "lastTestedAt" | "lastTestStatus" | "lastTestLatencyMs" | "lastTestStage"
> & {
  id?: string;
  password?: string;
  tlsClientKeyPassphrase?: string;
  proxyPassword?: string;
  sensitiveHeaders?: string;
  sshPassword?: string;
  sshPrivateKeyPassphrase?: string;
};

export type ConnectionTestStage = "dns" | "tcp" | "ssh" | "proxy" | "tls" | "authentication" | "gremlin" | "schema";
export type ConnectionTestStageResult = {
  stage: ConnectionTestStage;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  message: string;
};

export type ConnectionTestReport = {
  success: boolean;
  latencyMs: number;
  endpoint: string;
  stage: ConnectionTestStage;
  message: string;
  stages: ConnectionTestStageResult[];
};

export type CompatibilityCapability =
  | "sessionedClient"
  | "requestTimeout"
  | "serverCancellation"
  | "managementApi"
  | "configuredGraphFactory"
  | "configurationManagementGraph"
  | "janusGraphManager"
  | "jsonSchemaInitialization"
  | "graphsonIo"
  | "indexFieldStatus"
  | "indexStatusAwait"
  | "traversalExplain"
  | "traversalProfile";

export type CompatibilityCapabilityState = "supported" | "unsupported" | "unknown";

export type CompatibilityProfile = {
  connectionId: string;
  connectionSignature: string;
  status: "ready" | "partial" | "unavailable";
  janusGraphVersion: string;
  tinkerPopVersion: string;
  capabilities: Record<CompatibilityCapability, CompatibilityCapabilityState>;
  detectedAt: string;
  message: string;
};

export type QueryRequest = {
  connectionId: string;
  consoleId: string;
  executionId: string;
  query: string;
  graphName?: string;
  traversalSource?: string;
  bindings?: Record<string, unknown>;
  recordHistory?: boolean;
  productionConfirmed?: boolean;
  timeoutMs?: number;
  serverCancellation?: boolean;
};

export type QueryCancelRequest = {
  executionId: string;
};

export type QueryExportRequest = {
  connectionId: string;
  executionId: string;
  query: string;
  traversalSource?: string;
  bindings?: Record<string, unknown>;
  suggestedName: string;
  format: "json" | "jsonl";
};

export type QueryExportResult = {
  path: string | null;
  totalCount: number;
  durationMs: number;
};

export type QueryConsoleRequest = {
  connectionId: string;
  consoleId: string;
};

export type QueryExecutionResult = {
  executionId: string;
  durationMs: number;
  items: unknown[];
  consoleText?: string;
  truncated: boolean;
  totalCount: number;
};

export type QueryHistoryStatus =
  | "success"
  | "error"
  | "cancelled"
  | "truncated";

export type QueryHistoryEntry = {
  id: string;
  connectionId: string;
  connectionName: string;
  query: string;
  graphName: string;
  traversalSource: string;
  status: QueryHistoryStatus;
  durationMs: number;
  resultCount: number;
  errorMessage: string;
  createdAt: string;
};

export type QueryHistoryListInput = {
  limit?: number;
  offset?: number;
  connectionId?: string;
  statuses?: QueryHistoryStatus[];
  createdFrom?: string;
  createdTo?: string;
};

export type QueryAssetTag = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type QueryAssetFolder = {
  id: string;
  name: string;
  parentId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type QuerySnippet = {
  id: string;
  name: string;
  description: string;
  query: string;
  bindingsText: string;
  connectionId: string;
  graphName: string;
  traversalSource: string;
  folderId: string;
  starred: boolean;
  tags: QueryAssetTag[];
  createdAt: string;
  updatedAt: string;
};

export type SaveQueryAssetTagInput = Pick<QueryAssetTag, "name" | "color"> & { id?: string };
export type SaveQueryAssetFolderInput = Pick<QueryAssetFolder, "name" | "sortOrder"> & {
  id?: string;
  parentId?: string;
};
export type SaveQuerySnippetInput = Pick<
  QuerySnippet,
  "name" | "description" | "query" | "bindingsText" | "connectionId" | "graphName" | "traversalSource" | "folderId" | "starred"
> & { id?: string; tagIds?: string[] };
export type QuerySnippetListInput = {
  limit?: number;
  offset?: number;
  search?: string;
  folderId?: string;
  tagIds?: string[];
  starred?: boolean;
};
export type QueryHistoryAssetMetadata = {
  historyId: string;
  starred: boolean;
  note: string;
  tags: QueryAssetTag[];
  updatedAt: string;
};
export type SaveQueryHistoryAssetInput = {
  historyId: string;
  starred: boolean;
  note: string;
  tagIds: string[];
};
export type QueryHistoryAssetEntry = QueryHistoryEntry & {
  starred: boolean;
  note: string;
  tags: QueryAssetTag[];
  assetUpdatedAt: string;
};
export type QueryHistoryAssetListInput = QueryHistoryListInput & {
  search?: string;
  tagIds?: string[];
  starred?: boolean;
};
export type QueryHistoryAssetPage = {
  items: QueryHistoryAssetEntry[];
  total: number;
};

export type PickedDataFile = {
  name: string;
  extension: "json" | "csv";
  content: string;
};

export type SaveDataFileInput = {
  suggestedName: string;
  format: "json" | "jsonl" | "csv";
  content: string;
};

export type DockerContainerInfo = {
  id: string;
  name: string;
  image: string;
  status: string;
};

export type DockerRuntimeStatus = {
  available: boolean;
  containers: DockerContainerInfo[];
  cliPath?: string;
  message?: string;
};

export type DockerTransferTarget = {
  transferId: string;
  containerId: string;
  serverPath: string;
  name: string;
  sizeBytes?: number;
};

export type SaveResultFileInput = {
  suggestedName: string;
  format: "json" | "jsonl" | "csv";
  items: unknown[];
};

export type PickedQueryFile = {
  name: string;
  path: string;
  content: string;
};

export type PickedSchemaFile = {
  name: string;
  content: string;
};

export type SaveSchemaFileInput = {
  suggestedName: string;
  content: string;
};

export type PickedConnectionArchive = {
  name: string;
  content: string;
};

export type SaveConnectionArchiveInput = {
  suggestedName: string;
  content: string;
};

export type SaveQueryFileInput = {
  suggestedName: string;
  content: string;
};

export type SaveGraphFileInput = {
  suggestedName: string;
  format: "png" | "jpg" | "svg" | "json";
  content: string;
};

export type SecurityStorageStatus = {
  mode: "os" | "local-fallback";
  osEncryptionAvailable: boolean;
  fallbackKeyPresent: boolean;
  description: string;
};

export type SchemaJobStatus = "running" | "succeeded" | "failed" | "interrupted";

export type SchemaJob = {
  id: string;
  connectionId: string;
  connectionName: string;
  indexName: string;
  action: string;
  query: string;
  status: SchemaJobStatus;
  message: string;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
};

export type RunSchemaJobInput = {
  connectionId: string;
  indexName: string;
  action: string;
  query: string;
  queries?: string[];
  productionConfirmed?: boolean;
};

export type BackgroundTaskKind = "schema" | "transfer" | "maintenance" | "quality";
export type BackgroundTaskStatus =
  | "running"
  | "cancel_requested"
  | "succeeded"
  | "failed"
  | "interrupted";

export type BackgroundTask = {
  id: string;
  kind: BackgroundTaskKind;
  action: string;
  title: string;
  connectionId: string;
  connectionName: string;
  graphName: string;
  status: BackgroundTaskStatus;
  stage: string;
  message: string;
  progressCurrent: number;
  progressTotal: number;
  progressUnit: string;
  cancellable: boolean;
  retriable: boolean;
  acknowledged: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
};

export type PublishBackgroundTaskInput = Omit<
  BackgroundTask,
  "kind" | "connectionName" | "acknowledged" | "createdAt" | "updatedAt" | "completedAt"
> & {
  kind: "transfer" | "maintenance" | "quality";
};

export type GraphTransferAction = "import" | "export" | "purge";
export type GraphTransferAccess = "configured" | "binding";
export type GraphTransferFileAccess = "docker" | "path";

export type StartGraphTransferInput = {
  connectionId: string;
  action: GraphTransferAction;
  graphName: string;
  graphBinding: string;
  graphAccess: GraphTransferAccess;
  fileAccess: GraphTransferFileAccess;
  serverPath?: string;
  dockerContainerId?: string;
  dockerTransferId?: string;
  enableBatchLoading?: boolean;
  disableAutomaticSchema?: boolean;
  overwrite?: boolean;
  productionConfirmed?: boolean;
};

export type QualityRunMode = "bounded" | "full";
export type QualityGraphAccess = "binding" | "configured";
export type QualityRuleSeverity = "info" | "warning" | "error";
export type QualityRuleKind =
  | "isolated-vertex"
  | "duplicate-vertex"
  | "required-property"
  | "property-domain"
  | "edge-endpoint"
  | "degree-range"
  | "distribution";

export type QualityRule = {
  id: string;
  name: string;
  kind: QualityRuleKind;
  enabled: boolean;
  severity: QualityRuleSeverity;
  vertexLabel?: string;
  vertexLabels?: string[];
  ignoredEdgeLabels?: string[];
  propertyKeys?: string[];
  propertyKey?: string;
  ignoreMissing?: boolean;
  constraint?: "not-blank" | "number-range" | "enum";
  minimum?: number;
  maximum?: number;
  allowedValues?: string[];
  edgeLabel?: string;
  outVertexLabels?: string[];
  inVertexLabels?: string[];
  direction?: "in" | "out" | "both";
  minDegree?: number;
  maxDegree?: number;
  includeVertices?: boolean;
  includeEdges?: boolean;
};

export type QualityRuleSet = {
  id: string;
  name: string;
  description: string;
  connectionId: string;
  graphName: string;
  graphBinding: string;
  graphAccess: QualityGraphAccess;
  rules: QualityRule[];
  createdAt: string;
  updatedAt: string;
};

export type SaveQualityRuleSetInput = Omit<QualityRuleSet, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type QualityRunStatus = "running" | "cancel_requested" | "succeeded" | "failed" | "interrupted";
export type QualityRuleResultStatus = "pending" | "running" | "passed" | "issues" | "failed" | "skipped" | "interrupted";

export type QualitySample = {
  id: string;
  label: string;
  values: Record<string, string | number | boolean | null>;
};

export type QualityRuleResult = {
  id: string;
  runId: string;
  ruleId: string;
  ruleName: string;
  ruleKind: QualityRuleKind;
  severity: QualityRuleSeverity;
  status: QualityRuleResultStatus;
  issueCount: number;
  checkedCount: number;
  coverageLimit: number;
  message: string;
  query: string;
  samples: QualitySample[];
  startedAt: string;
  completedAt: string;
};

export type QualityRun = {
  id: string;
  ruleSetId: string;
  ruleSetName: string;
  connectionId: string;
  connectionName: string;
  graphName: string;
  graphBinding: string;
  graphAccess: QualityGraphAccess;
  mode: QualityRunMode;
  sampleLimit: number;
  scanLimit: number;
  status: QualityRunStatus;
  stage: string;
  currentRule: number;
  totalRules: number;
  issueCount: number;
  checkedCount: number;
  message: string;
  ruleSetSnapshot: QualityRuleSet;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
};

export type QualityRunDetail = QualityRun & { results: QualityRuleResult[] };

export type StartQualityRunInput = {
  ruleSetId: string;
  mode: QualityRunMode;
  scanLimit?: number;
  sampleLimit?: number;
  timeoutMs?: number;
  productionConfirmed?: boolean;
  confirmedGraphName?: string;
};

export type QualityRunListInput = {
  connectionId?: string;
  ruleSetId?: string;
  statuses?: QualityRunStatus[];
  limit?: number;
};

export type DiagnosticLogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticLogSource =
  | "application"
  | "renderer"
  | "ipc"
  | "connection"
  | "query"
  | "schema"
  | "transfer"
  | "compatibility"
  | "storage"
  | "security";

export type DiagnosticLogEntry = {
  id: string;
  timestamp: string;
  level: DiagnosticLogLevel;
  source: DiagnosticLogSource;
  event: string;
  message: string;
  context?: Record<string, unknown>;
  error?: unknown;
};

export type DiagnosticLogListInput = {
  limit?: number;
  levels?: DiagnosticLogLevel[];
  sources?: DiagnosticLogSource[];
};

export type DiagnosticRuntimeSummary = {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  osRelease: string;
  architecture: string;
};

export type DiagnosticIncidentContext = {
  source: "connection" | "schema" | "graphFactory" | "task";
  title: string;
  connectionName?: string;
  graphName?: string;
  stage?: string;
  message?: string;
  occurredAt: string;
};

export type DiagnosticPreviewSnapshot = {
  generatedAt: string;
  runtime: DiagnosticRuntimeSummary;
  tasks: BackgroundTask[];
  logs: DiagnosticLogEntry[];
  incident?: DiagnosticIncidentContext;
};

export type DiagnosticPreviewSelection = {
  summary: boolean;
  tasks: boolean;
  logs: boolean;
};

export type DiagnosticPreviewInput = DiagnosticLogListInput & {
  incident?: DiagnosticIncidentContext;
};

export type DiagnosticBundleInput = DiagnosticPreviewInput & {
  selection: DiagnosticPreviewSelection;
};

export type DiagnosticBundleResult = {
  path: string | null;
  fileCount: number;
};

export type DiagnosticFindingCode =
  | "instance-id-conflict"
  | "graphson-serialization"
  | "evaluation-timeout"
  | "elasticsearch-shard-limit"
  | "schema-name-conflict"
  | "index-lifecycle"
  | "configured-graph-factory"
  | "capability-probe";

export type DiagnosticFinding = {
  code: DiagnosticFindingCode;
  severity: "critical" | "warning" | "info";
  confidence: "confirmed" | "likely" | "hint";
  evidence: Array<{ source: string; excerpt: string }>;
};

export type DiagnosticReport = {
  generatedAt: string;
  signalsScanned: number;
  findings: DiagnosticFinding[];
};

export type DiagnosticBundleInspectionResult = {
  name: string;
  fileNames: string[];
  report: DiagnosticReport;
};

export type DiagnosticRecordStatus = "unread" | "acknowledged" | "resolved";
export type DiagnosticRecordOrigin = "live" | "bundle";

export type DiagnosticRecord = {
  id: string;
  fingerprint: string;
  origin: DiagnosticRecordOrigin;
  sourceName: string;
  status: DiagnosticRecordStatus;
  incident?: DiagnosticIncidentContext;
  report: DiagnosticReport;
  occurrenceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SaveDiagnosticRecordInput = {
  origin: DiagnosticRecordOrigin;
  sourceName?: string;
  incident?: DiagnosticIncidentContext;
  report: DiagnosticReport;
};

export type DesktopApi = {
  runtime: {
    platform(): Promise<string>;
    writeClipboard(text: string): Promise<void>;
    onNavigate(listener: (destination: "settings") => void): () => void;
  };
  diagnostics: {
    runtime(): Promise<DiagnosticRuntimeSummary>;
    listLogs(input?: DiagnosticLogListInput): Promise<DiagnosticLogEntry[]>;
    preview(input?: DiagnosticPreviewInput): Promise<DiagnosticPreviewSnapshot>;
    exportBundle(input: DiagnosticBundleInput): Promise<DiagnosticBundleResult>;
    inspectBundle(): Promise<DiagnosticBundleInspectionResult | null>;
    listRecords(limit?: number): Promise<DiagnosticRecord[]>;
    saveRecord(input: SaveDiagnosticRecordInput): Promise<DiagnosticRecord>;
    setRecordStatus(id: string, status: DiagnosticRecordStatus): Promise<DiagnosticRecord>;
    removeRecord(id: string): Promise<void>;
  };
  connections: {
    list(): Promise<ConnectionSummary[]>;
    save(input: SaveConnectionInput): Promise<ConnectionSummary>;
    remove(id: string): Promise<void>;
    test(input: SaveConnectionInput): Promise<ConnectionTestReport>;
    onSshTunnelChanged(listener: (connectionId: string, snapshot: ConnectionSshTunnelSnapshot) => void): () => void;
  };
  authProfiles: {
    list(): Promise<AuthenticationProfile[]>;
    save(input: SaveAuthenticationProfileInput): Promise<AuthenticationProfile>;
    remove(id: string): Promise<void>;
  };
  compatibility: {
    get(connectionId: string, refresh?: boolean): Promise<CompatibilityProfile>;
  };
  queries: {
    execute(input: QueryRequest): Promise<QueryExecutionResult>;
    cancel(input: QueryCancelRequest): Promise<boolean>;
    closeConsole(input: QueryConsoleRequest): Promise<void>;
    export(input: QueryExportRequest): Promise<QueryExportResult>;
  };
  history: {
    list(input?: number | QueryHistoryListInput): Promise<QueryHistoryEntry[]>;
    remove(id: string): Promise<void>;
    removeMany(ids: string[]): Promise<void>;
    clear(): Promise<void>;
  };
  queryAssets: {
    listTags(): Promise<QueryAssetTag[]>;
    saveTag(input: SaveQueryAssetTagInput): Promise<QueryAssetTag>;
    removeTag(id: string): Promise<void>;
    listFolders(): Promise<QueryAssetFolder[]>;
    saveFolder(input: SaveQueryAssetFolderInput): Promise<QueryAssetFolder>;
    removeFolder(id: string): Promise<void>;
    listSnippets(input?: QuerySnippetListInput): Promise<QuerySnippet[]>;
    saveSnippet(input: SaveQuerySnippetInput): Promise<QuerySnippet>;
    removeSnippet(id: string): Promise<void>;
    historyMetadata(historyIds: string[]): Promise<QueryHistoryAssetMetadata[]>;
    saveHistoryMetadata(input: SaveQueryHistoryAssetInput): Promise<QueryHistoryAssetMetadata>;
    listHistory(input?: QueryHistoryAssetListInput): Promise<QueryHistoryAssetPage>;
    saveHistoryMetadataBatch(inputs: SaveQueryHistoryAssetInput[]): Promise<QueryHistoryAssetMetadata[]>;
  };
  files: {
    pickTlsFile(kind: "ca" | "certificate" | "private-key"): Promise<string | null>;
    pickDataFile(): Promise<PickedDataFile | null>;
    saveDataFile(input: SaveDataFileInput): Promise<string | null>;
    saveResultFile(input: SaveResultFileInput): Promise<string | null>;
    saveGraphFile(input: SaveGraphFileInput): Promise<string | null>;
    pickQueryFile(): Promise<PickedQueryFile | null>;
    saveQueryFile(input: SaveQueryFileInput): Promise<string | null>;
    pickSchemaFile(): Promise<PickedSchemaFile | null>;
    saveSchemaFile(input: SaveSchemaFileInput): Promise<string | null>;
    pickConnectionArchive(): Promise<PickedConnectionArchive | null>;
    saveConnectionArchive(input: SaveConnectionArchiveInput): Promise<string | null>;
  };
  dataTransfers: {
    dockerStatus(): Promise<DockerRuntimeStatus>;
    stageDockerImport(containerId: string): Promise<DockerTransferTarget | null>;
    prepareDockerExport(containerId: string): Promise<DockerTransferTarget>;
    finishDockerExport(transferId: string, suggestedName: string): Promise<string | null>;
    cleanupDockerTransfer(transferId: string): Promise<boolean>;
    start(input: StartGraphTransferInput): Promise<BackgroundTask>;
    cancel(taskId: string): Promise<boolean>;
    retry(taskId: string): Promise<BackgroundTask>;
  };
  security: {
    status(): Promise<SecurityStorageStatus>;
  };
  schemaJobs: {
    list(connectionId?: string): Promise<SchemaJob[]>;
    run(input: RunSchemaJobInput): Promise<SchemaJob>;
    cancel(connectionId: string): Promise<boolean>;
    retry(id: string): Promise<SchemaJob>;
    dismiss(id: string): Promise<void>;
  };
  tasks: {
    list(limit?: number): Promise<BackgroundTask[]>;
    publish(input: PublishBackgroundTaskInput): Promise<BackgroundTask>;
    acknowledge(id?: string): Promise<void>;
    dismiss(id: string): Promise<void>;
  };
  quality: {
    listRuleSets(connectionId?: string): Promise<QualityRuleSet[]>;
    saveRuleSet(input: SaveQualityRuleSetInput): Promise<QualityRuleSet>;
    removeRuleSet(id: string): Promise<void>;
    start(input: StartQualityRunInput): Promise<QualityRun>;
    listRuns(input?: QualityRunListInput): Promise<QualityRun[]>;
    getRun(id: string): Promise<QualityRunDetail>;
    cancel(id: string): Promise<boolean>;
    retry(id: string): Promise<QualityRun>;
    removeRun(id: string): Promise<void>;
    exportRun(id: string): Promise<string | null>;
  };
};
