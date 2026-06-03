import { NextResponse } from "next/server";
import { handlers } from "@/auth";

export const runtime = "nodejs";

// Auth.js endpoints exist only on the owner deployment. On public/local
// deployments (which have no AUTH_SECRET / GitHub credentials) they would 500;
// return a clean 404 instead so the routes are simply absent there.
const enabled = process.env.ATLAS_MODE === "owner";
const off = () => new NextResponse("Not found", { status: 404 });

export const GET = enabled ? handlers.GET : off;
export const POST = enabled ? handlers.POST : off;
