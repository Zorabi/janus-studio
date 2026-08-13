export type ConnectionProtocol = "ws" | "wss" | "http" | "https";
export type GremlinClientMode = "sessionless" | "sessioned";
export type ConnectionEnvironment = "dev" | "test" | "prod";

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
  enableCompression: boolean;
  customHeaders: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionSummary = ConnectionProfile & {
  hasPassword: boolean;
};

export type SaveConnectionInput = Omit<
  ConnectionProfile,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
  password?: string;
};

export type ConnectionTestReport = {
  success: boolean;
  latencyMs: number;
  endpoint: string;
  stage: "validation" | "network" | "authentication" | "query";
  message: string;
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

export type BackgroundTaskKind = "schema" | "transfer" | "maintenance";
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
  kind: "transfer" | "maintenance";
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

export type DesktopApi = {
  runtime: {
    platform(): Promise<string>;
    writeClipboard(text: string): Promise<void>;
    onNavigate(listener: (destination: "settings") => void): () => void;
  };
  connections: {
    list(): Promise<ConnectionSummary[]>;
    save(input: SaveConnectionInput): Promise<ConnectionSummary>;
    remove(id: string): Promise<void>;
    test(input: SaveConnectionInput): Promise<ConnectionTestReport>;
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
    pickDataFile(): Promise<PickedDataFile | null>;
    saveDataFile(input: SaveDataFileInput): Promise<string | null>;
    saveResultFile(input: SaveResultFileInput): Promise<string | null>;
    saveGraphFile(input: SaveGraphFileInput): Promise<string | null>;
    pickQueryFile(): Promise<PickedQueryFile | null>;
    saveQueryFile(input: SaveQueryFileInput): Promise<string | null>;
    pickSchemaFile(): Promise<PickedSchemaFile | null>;
    saveSchemaFile(input: SaveSchemaFileInput): Promise<string | null>;
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
};
