import { getAuth } from "@/server/auth";

// Resolve Better Auth per request so the build needs no runtime secrets.
export const GET = (request: Request) => getAuth().handler(request);
export const POST = (request: Request) => getAuth().handler(request);
