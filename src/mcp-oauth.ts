import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type {
  OAuthClientInformationMixed,
  OAuthClientProvider,
  OAuthClientInformationContext,
  OAuthClientMetadata,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
  StreamableHTTPClientTransport
} from "@modelcontextprotocol/client";

const STORAGE_PREFIX = "localAgentCompanion.mcpOAuth.v1.";
const CALLBACK_TIMEOUT_MS = 5 * 60_000;

type StoredOAuthState = {
  issuers: Record<string, {
    clientInformation?: StoredOAuthClientInformation;
    tokens?: StoredOAuthTokens;
  }>;
  latestIssuer?: string;
};

/**
 * OAuth state for one approved MCP connection. Tokens and registered-client
 * metadata are persisted in VS Code Secret Storage; PKCE and callback state
 * remain in memory and are never written to disk.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private server?: Server;
  private callback?: Promise<URLSearchParams>;
  private callbackResolve?: (params: URLSearchParams) => void;
  private callbackReject?: (error: Error) => void;
  private callbackTimer?: NodeJS.Timeout;
  private pendingCallbackParams?: URLSearchParams;
  private codeVerifierValue?: string;
  private stateValue?: string;
  private latestIssuer?: string;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileId: string,
    private readonly serverUrl: URL,
    private readonly onStatus?: (message: string) => void
  ) {}

  public get redirectUrl(): string | undefined {
    const address = this.server?.address();
    if (!address || typeof address === "string") return undefined;
    return `http://127.0.0.1:${address.port}/callback`;
  }

  public get clientMetadata(): OAuthClientMetadata {
    const redirectUrl = this.redirectUrl;
    if (!redirectUrl) throw new Error("The local OAuth callback is not ready.");
    return {
      client_name: "Local Agent Companion",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    };
  }

  public async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => this.handleCallback(request, response));
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });
  }

  public async close(): Promise<void> {
    if (this.callbackTimer) clearTimeout(this.callbackTimer);
    this.callbackReject?.(new Error("OAuth authorization was cancelled."));
    this.callback = undefined;
    this.callbackResolve = undefined;
    this.callbackReject = undefined;
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  public state(): string {
    this.stateValue = randomBytes(32).toString("base64url");
    return this.stateValue;
  }

  public async clientInformation(ctx?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined> {
    const state = await this.readState();
    const issuer = ctx?.issuer ?? this.latestIssuer ?? state.latestIssuer;
    return issuer ? state.issuers[issuer]?.clientInformation : undefined;
  }

  public async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    if (!ctx?.issuer) throw new Error("The MCP OAuth issuer was not provided by the SDK.");
    this.latestIssuer = ctx.issuer;
    const state = await this.readState();
    state.issuers[ctx.issuer] = { ...state.issuers[ctx.issuer], clientInformation };
    state.latestIssuer = ctx.issuer;
    await this.writeState(state);
  }

  public async tokens(ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    const state = await this.readState();
    const issuer = ctx?.issuer ?? this.latestIssuer ?? state.latestIssuer;
    return issuer ? state.issuers[issuer]?.tokens : undefined;
  }

  public async saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): Promise<void> {
    if (!ctx?.issuer) throw new Error("The MCP OAuth issuer was not provided by the SDK.");
    this.latestIssuer = ctx.issuer;
    const state = await this.readState();
    state.issuers[ctx.issuer] = { ...state.issuers[ctx.issuer], tokens };
    state.latestIssuer = ctx.issuer;
    await this.writeState(state);
  }

  public async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (authorizationUrl.protocol !== "https:") {
      throw new Error("The MCP authorization URL must use HTTPS.");
    }
    this.onStatus?.("OAuth login required. Opening the corporate sign-in page.");
    if (!(await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl.href)))) {
      throw new Error("VS Code could not open the MCP authorization page.");
    }
  }

  public saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier;
  }

  public codeVerifier(): string {
    if (!this.codeVerifierValue) throw new Error("The MCP OAuth code verifier is missing.");
    return this.codeVerifierValue;
  }

  public async finishAuthorization(transport: StreamableHTTPClientTransport): Promise<void> {
    const params = await this.waitForCallback();
    const returnedState = params.get("state");
    if (!returnedState || returnedState !== this.stateValue) {
      throw new Error("The MCP OAuth callback state did not match the authorization request.");
    }
    if (params.get("error")) throw new Error("The MCP OAuth authorization was declined.");
    await transport.finishAuth(params);
  }

  private async waitForCallback(): Promise<URLSearchParams> {
    if (this.pendingCallbackParams) {
      const params = this.pendingCallbackParams;
      this.pendingCallbackParams = undefined;
      return params;
    }
    if (!this.callback) {
      this.callback = new Promise<URLSearchParams>((resolve, reject) => {
        this.callbackResolve = resolve;
        this.callbackReject = reject;
        this.callbackTimer = setTimeout(() => {
          this.callback = undefined;
          this.callbackResolve = undefined;
          this.callbackReject = undefined;
          reject(new Error("Timed out waiting for the MCP OAuth callback."));
        }, CALLBACK_TIMEOUT_MS);
      });
    }
    return this.callback;
  }

  private handleCallback(
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse
  ): void {
    const host = request.headers.host?.split(":")[0];
    if (request.method !== "GET" || request.url === undefined || host !== "127.0.0.1") {
      response.writeHead(404).end();
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url, "http://127.0.0.1");
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (url.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<html><body><p>Authorization received. You may return to VS Code.</p></body></html>");
    if (!this.callbackResolve) {
      this.pendingCallbackParams = url.searchParams;
      return;
    }
    if (this.callbackTimer) clearTimeout(this.callbackTimer);
    const resolve = this.callbackResolve;
    this.callback = undefined;
    this.callbackResolve = undefined;
    this.callbackReject = undefined;
    resolve(url.searchParams);
  }

  private async readState(): Promise<StoredOAuthState> {
    const raw = await this.context.secrets.get(`${STORAGE_PREFIX}${this.profileId}`);
    if (!raw) return { issuers: {} };
    try {
      const parsed = JSON.parse(raw) as Partial<StoredOAuthState>;
      return parsed && typeof parsed === "object" && parsed.issuers && typeof parsed.issuers === "object"
        ? { issuers: parsed.issuers as StoredOAuthState["issuers"], latestIssuer: parsed.latestIssuer }
        : { issuers: {} };
    } catch {
      return { issuers: {} };
    }
  }

  private async writeState(state: StoredOAuthState): Promise<void> {
    await this.context.secrets.store(`${STORAGE_PREFIX}${this.profileId}`, JSON.stringify(state));
  }
}
