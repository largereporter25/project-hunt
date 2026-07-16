import { StubTool } from "./base";

export class MaltegoStub extends StubTool {
  readonly name = "maltego";
  readonly accepts = new Set(["domain", "email", "ipv4", "person"]);
  readonly emits = new Set(["domain", "email", "org", "person"]);
  readonly docs_url = "https://docs.maltego.com/";
  readonly description = "Maltego transform hub — commercial OSINT transforms.";
}
