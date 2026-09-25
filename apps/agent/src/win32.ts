import koffi from "koffi";
import { createHash } from "node:crypto";

const kernel32 = koffi.load("kernel32.dll");
const user32 = koffi.load("user32.dll");

const HANDLE = koffi.pointer("HANDLE", koffi.opaque());

const PROCESSENTRY32W = koffi.struct("PROCESSENTRY32W", {
  dwSize: "uint32",
  cntUsage: "uint32",
  th32ProcessID: "uint32",
  th32DefaultHeapID: "uintptr_t",
  th32ModuleID: "uint32",
  cntThreads: "uint32",
  th32ParentProcessID: "uint32",
  pcPriClassBase: "int32",
  dwFlags: "uint32",
  szExeFile: koffi.array("char16_t", 260, "String"),
});

const LASTINPUTINFO = koffi.struct("LASTINPUTINFO", {
  cbSize: "uint32",
  dwTime: "uint32",
});

const CreateToolhelp32Snapshot = kernel32.func(
  "HANDLE __stdcall CreateToolhelp32Snapshot(uint32 dwFlags, uint32 th32ProcessID)",
);
const Process32FirstW = kernel32.func(
  "int __stdcall Process32FirstW(HANDLE hSnapshot, _Inout_ PROCESSENTRY32W *lppe)",
);
const Process32NextW = kernel32.func(
  "int __stdcall Process32NextW(HANDLE hSnapshot, _Inout_ PROCESSENTRY32W *lppe)",
);
const OpenProcess = kernel32.func(
  "HANDLE __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)",
);
const TerminateProcess = kernel32.func("int __stdcall TerminateProcess(HANDLE hProcess, uint32 uExitCode)");
const CloseHandle = kernel32.func("int __stdcall CloseHandle(HANDLE hObject)");
const CreateMutexW = kernel32.func("HANDLE __stdcall CreateMutexW(void *attributes, int owner, str16 name)");
const WaitForSingleObject = kernel32.func("uint32 __stdcall WaitForSingleObject(HANDLE handle, uint32 timeout)");
const ReleaseMutex = kernel32.func("int __stdcall ReleaseMutex(HANDLE handle)");
const Beep = kernel32.func("int __stdcall Beep(uint32 frequency, uint32 duration)");
const GetTickCount = kernel32.func("uint32 __stdcall GetTickCount()");
const GetLastInputInfo = user32.func("int __stdcall GetLastInputInfo(_Inout_ LASTINPUTINFO *plii)");

const TH32CS_SNAPPROCESS = 0x2;
const PROCESS_TERMINATE = 0x1;

export type ProcessInfo = { pid: number; name: string };

// Synchronous so the short chime finishes even when the agent exits immediately.
// https://learn.microsoft.com/en-us/windows/win32/api/utilapiset/nf-utilapiset-beep
export function playCompletionSound(): boolean {
  try {
    return Beep(660, 150) !== 0 && Beep(880, 150) !== 0 && Beep(1047, 300) !== 0;
  } catch {
    return false;
  }
}

// Two even tones, unlike the rising completion chime, so a check-in is recognizable from across the room.
export function playCheckInSound(): boolean {
  try {
    return Beep(523, 200) !== 0 && Beep(523, 200) !== 0;
  } catch {
    return false;
  }
}

// Any mouse or keyboard input in this Windows session, not only keys typed into the terminal.
// https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo
export function msSinceLastInput(): number {
  const info = { cbSize: koffi.sizeof(LASTINPUTINFO), dwTime: 0 };
  if (!GetLastInputInfo(info)) return 0;
  // Both are 32-bit tick counts that wrap every ~49.7 days; unsigned subtraction handles the wrap.
  return (GetTickCount() - info.dwTime) >>> 0;
}

// Windows releases ownership if the agent exits or is killed; no stale lock file.
// https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createmutexw
export function acquireSessionLock(identity: string): (() => void) | null {
  const name = `Local\\Focus-${createHash("sha256").update(identity.toLowerCase()).digest("hex")}`;
  const handle = CreateMutexW(null, 0, name);
  if (!handle) throw new Error("Could not create the Focus session lock.");
  const result = WaitForSingleObject(handle, 0);
  if (result !== 0 && result !== 0x80) {
    CloseHandle(handle);
    if (result === 0x102) return null;
    throw new Error("Could not acquire the Focus session lock.");
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ReleaseMutex(handle);
    CloseHandle(handle);
  };
}

export function listProcesses(): ProcessInfo[] {
  const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  const entry = { dwSize: koffi.sizeof(PROCESSENTRY32W) } as Record<string, unknown>;
  const result: ProcessInfo[] = [];
  try {
    for (let ok = Process32FirstW(snapshot, entry); ok; ok = Process32NextW(snapshot, entry)) {
      result.push({ pid: entry.th32ProcessID as number, name: entry.szExeFile as string });
    }
  } finally {
    CloseHandle(snapshot);
  }
  return result;
}

export function killProcess(pid: number): boolean {
  const handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
  if (!handle) return false;
  try {
    return TerminateProcess(handle, 1) !== 0;
  } finally {
    CloseHandle(handle);
  }
}
