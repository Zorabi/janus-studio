declare module "gremlin" {
  type Authenticator = object;

  class PlainTextSaslAuthenticator {
    constructor(username: string, password: string);
  }

  class ResultSet {
    readonly length: number;
    [Symbol.iterator](): Iterator<unknown>;
    toArray(): unknown[];
  }

  class Client {
    constructor(
      url: string,
      options?: {
        traversalSource?: string;
        processor?: string;
        session?: string;
        mimeType?: string;
        authenticator?: Authenticator;
        headers?: Record<string, string>;
        rejectUnauthorized?: boolean;
        enableCompression?: boolean;
      },
    );
    submit(
      message: string,
      bindings?: Record<string, unknown>,
    ): Promise<ResultSet>;
    stream(
      message: string,
      bindings?: Record<string, unknown>,
    ): NodeJS.ReadableStream & AsyncIterable<ResultSet>;
    close(): Promise<void>;
  }

  const gremlin: {
    driver: {
      Client: typeof Client;
      auth: {
        PlainTextSaslAuthenticator: typeof PlainTextSaslAuthenticator;
      };
    };
  };

  export default gremlin;
}
