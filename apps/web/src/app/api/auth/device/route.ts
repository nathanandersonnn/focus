import { handleDeviceLogin } from "@/lib/handleDeviceLogin";

export async function POST(request: Request) {
  return handleDeviceLogin(request, process.env.FOCUS_DEVICE_KEY);
}
