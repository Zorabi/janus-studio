export type ConnectionProtocol = "ws" | "wss" | "http" | "https";
export type GremlinClientMode = "sessionless" | "sessioned";

export type ConnectionProfile = {
  id: string;
  name: string;
  protocol: ConnectionProtocol;
  host: string;
  port: number;
  path: string;
  username: string;
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

export type QueryRequest = {
  connectionId: string;
  consoleId: string;
  executionId: string;
  query: string;
  bindings?: Record<string, unknown>;
  recordHistory?: boolean;
};

export type QueryCancelRequest = {
  executionId: string;
};

export type QueryExportRequest = {
  connectionId: string;
  executionId: string;
  query: string;
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
  truncated: boolean;
  totalCount: number;
};

export type QueryHistoryEntry = {
  id: string;
  connectionId: string;
  connectionName: string;
  query: string;
  status: "success" | "error";
  durationMs: number;
  resultCount: number;
  errorMessage: string;
  createdAt: string;
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

export type SaveQueryFileInput = {
  suggestedName: string;
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
};

export type DesktopApi = {
  runtime: {
    platform(): Promise<string>;
    onNavigate(listener: (destination: "settings") => void): () => void;
  };
  connections: {
    list(): Promise<ConnectionSummary[]>;
    save(input: SaveConnectionInput): Promise<ConnectionSummary>;
    remove(id: string): Promise<void>;
    test(input: SaveConnectionInput): Promise<ConnectionTestReport>;
  };
  queries: {
    execute(input: QueryRequest): Promise<QueryExecutionResult>;
    cancel(input: QueryCancelRequest): Promise<boolean>;
    closeConsole(input: QueryConsoleRequest): Promise<void>;
    export(input: QueryExportRequest): Promise<QueryExportResult>;
  };
  history: {
    list(limit?: number): Promise<QueryHistoryEntry[]>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
  };
  files: {
    pickDataFile(): Promise<PickedDataFile | null>;
    saveDataFile(input: SaveDataFileInput): Promise<string | null>;
    saveResultFile(input: SaveResultFileInput): Promise<string | null>;
    pickQueryFile(): Promise<PickedQueryFile | null>;
    saveQueryFile(input: SaveQueryFileInput): Promise<string | null>;
  };
  security: {
    status(): Promise<SecurityStorageStatus>;
  };
  schemaJobs: {
    list(connectionId?: string): Promise<SchemaJob[]>;
    run(input: RunSchemaJobInput): Promise<SchemaJob>;
    retry(id: string): Promise<SchemaJob>;
  };
};
