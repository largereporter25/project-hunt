import { StubTool } from "./base";

export class ShodanStub extends StubTool {
  readonly name = "shodan";
  readonly accepts = new Set(["domain", "ipv4", "ipv6"]);
  readonly emits = new Set(["ipv4", "asn", "org", "url"]);
  readonly docs_url = "https://developer.shodan.io/api";
  readonly description = "Shodan — internet-wide host scanning & banners.";
}
