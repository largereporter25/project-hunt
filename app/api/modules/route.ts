/**
 * Static tool catalogue.
 *
 * Same shape the Python `/api/v1/modules` returned: array of
 * ModuleInfo-like objects. No DB, no instantiation, no upstream
 * calls — this route cannot 500 in normal operation.
 */

import { NextResponse } from "next/server";
import { catalogueMetadata } from "@/lib/tools/registry";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(catalogueMetadata());
}
