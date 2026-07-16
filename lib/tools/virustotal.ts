import { StubTool } from "./base";

export class VirusTotalStub extends StubTool {
  readonly name = "virustotal";
  readonly accepts = new Set(["domain", "ipv4", "url", "hash", "person", "org"]);
  readonly emits = new Set(["domain", "hash", "url"]);
  readonly docs_url = "https://docs.virustotal.com/";
  readonly description = "VirusTotal — file/URL/domain reputation.";
}
