import { StubTool } from "./base";

export class HibpStub extends StubTool {
  readonly name = "hibp";
  readonly accepts = new Set(["email"]);
  readonly emits = new Set(["breach", "email"]);
  readonly docs_url = "https://haveibeenpwned.com/API/v3";
  readonly description = "HaveIBeenPwned — email breach exposure.";
}
