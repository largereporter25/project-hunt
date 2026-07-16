import { StubTool } from "./base";

export class SecurityTrailsStub extends StubTool {
  readonly name = "securitytrails";
  readonly accepts = new Set(["domain"]);
  readonly emits = new Set(["domain", "ipv4"]);
  readonly docs_url = "https://docs.securitytrails.com/";
  readonly description = "SecurityTrails — historical DNS + subdomain enumeration.";
}
