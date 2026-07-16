import { StubTool } from "./base";

export class GreyNoiseStub extends StubTool {
  readonly name = "greynoise";
  readonly accepts = new Set(["ipv4"]);
  readonly emits = new Set(["ipv4"]);
  readonly docs_url = "https://docs.greynoise.io/";
  readonly description = "GreyNoise — internet scanner/benign classification.";
}
