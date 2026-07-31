import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() { const jar = await cookies(); jar.delete("rf_google_connection"); jar.delete("rf_google_oauth"); return NextResponse.json({ connected: false }); }
