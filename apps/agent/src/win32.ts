import koffi from "koffi";

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
const GetTickCount = kernel32.func("uint32 __stdcall GetTickCount()");
const GetLastInputInfo = user32.func("int __stdcall GetLastInputInfo(_Inout_ LASTINPUTINFO *plii)");

const TH32CS_SNAPPROCESS = 0x2;
const PROCESS_TERMINATE = 0x1;

export type ProcessInfo = { pid: number; name: string };

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

export function msSinceLastInput(): number {
  const info = { cbSize: koffi.sizeof(LASTINPUTINFO), dwTime: 0 };
  if (!GetLastInputInfo(info)) return 0;
  // Both are 32-bit tick counts that wrap every ~49.7 days; unsigned subtraction handles the wrap.
  return (GetTickCount() - info.dwTime) >>> 0;
}
