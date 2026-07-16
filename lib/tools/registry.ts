/**
 * Tool registry — single source of truth for the catalogue and the
 * runtime instantiation.
 *
 * Every tool the dashboard can see, in one place. Order = display
 * order in the UI catalogue.
 *
 * Same shape as the Python `api/core/hunt/ingestion/registry.py`.
 */

import type { ToolFunction } from "./base";
import { isKeyPresent } from "../config";
import { DnsTool } from "./dns";
import { WhoisTool } from "./whois";
import { CrtshTool } from "./crtsh";
import { WaybackTool } from "./wayback";
import { IpinfoTool } from "./ipinfo";
import { FactCheckTool } from "./factcheck";
import { IndianKanoonTool } from "./indian_kanoon";
import { ECourtsTool } from "./ecourts";
import { TafcopTool } from "./tafcop";
import { MyNetaAdrTool } from "./myneta_adr";
import { ShodanStub } from "./shodan";
import { VirusTotalStub } from "./virustotal";
import { HibpStub } from "./hibp";
import { GreyNoiseStub } from "./greynoise";
import { SecurityTrailsStub } from "./securitytrails";
import { MaltegoStub } from "./maltego";

const TOOL_CATALOGUE_CONSTRUCTORS: (new () => ToolFunction)[] = [
  // Free, no-key tools (work out of the box).
  DnsTool,
  WhoisTool,
  CrtshTool,
  WaybackTool,
  IpinfoTool,
  IndianKanoonTool,
  ECourtsTool,
  TafcopTool,
  MyNetaAdrTool,
  FactCheckTool,
  // Key-required tools.
  ShodanStub,
  VirusTotalStub,
  HibpStub,
  GreyNoiseStub,
  SecurityTrailsStub,
  MaltegoStub,
];

/** Static catalogue metadata for the dashboard. No DB, no instantiation. */
export function catalogueMetadata(): Array<{
  name: string;
  accepts: string[];
  emits: string[];
  key_required: boolean;
  key_present: boolean;
  docs_url: string | undefined;
  description: string;
}> {
  return TOOL_CATALOGUE_CONSTRUCTORS.map((C) => {
    // Construct a throwaway instance to read its metadata.
    const inst = new C();
    return {
      name: inst.name,
      accepts: [...inst.accepts].sort(),
      emits: [...inst.emits].sort(),
      key_required: inst.key_required,
      key_present: isKeyPresent(inst.name),
      docs_url: inst.docs_url,
      description: inst.description,
    };
  });
}

/** Instantiate only the tools usable for this deployment. */
export function availableTools(): ToolFunction[] {
  const out: ToolFunction[] = [];
  for (const C of TOOL_CATALOGUE_CONSTRUCTORS) {
    const inst = new C();
    if (inst.key_required && !isKeyPresent(inst.name)) continue;
    out.push(inst);
  }
  return out;
}

/** Look up a single tool by name. Throws if unknown. */
export function toolByName(name: string): ToolFunction {
  for (const C of TOOL_CATALOGUE_CONSTRUCTORS) {
    const inst = new C();
    if (inst.name === name) return inst;
  }
  throw new Error(`unknown tool: ${name}`);
}
