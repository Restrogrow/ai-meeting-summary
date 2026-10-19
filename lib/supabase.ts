import "server-only";
import { createClient } from "@supabase/supabase-js";

export const BUCKET = "recordings";

export function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// Private bucket for meeting audio; created on first use
let bucketReady = false;
export async function ensureBucket() {
  if (bucketReady) return;
  const { error } = await db().storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw new Error(`Storage: ${error.message}`);
  bucketReady = true;
}
