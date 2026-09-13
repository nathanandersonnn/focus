import { insertSession } from "@/lib/db";
import { handleSessionPost } from "@/lib/handleSessionPost";

export async function POST(request: Request) {
  return handleSessionPost(request, { deviceKey: process.env.FOCUS_DEVICE_KEY, insert: insertSession });
}
