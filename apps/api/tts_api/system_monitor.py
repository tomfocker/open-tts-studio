import ctypes
import shutil
import subprocess
import time


APP_STARTED_AT = time.time()


def collect_system_status() -> dict:
    return {
        "api": {
            "status": "ok",
            "uptime_seconds": int(time.time() - APP_STARTED_AT),
            "started_at": APP_STARTED_AT,
        },
        "system": {
            "cpu_percent": get_cpu_percent(),
            **get_memory_status(),
        },
        "gpu": get_gpu_status(),
    }


def get_cpu_percent() -> float | None:
    command = [
        "powershell",
        "-NoProfile",
        "-Command",
        "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=2)
    except Exception:
        return None
    if completed.returncode != 0:
        return None
    try:
        return round(float(completed.stdout.strip()), 1)
    except ValueError:
        return None


def get_memory_status() -> dict:
    if not hasattr(ctypes, "windll"):
        return {
            "memory_total_mb": None,
            "memory_used_mb": None,
            "memory_percent": None,
        }

    class MemoryStatusEx(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    status = MemoryStatusEx()
    status.dwLength = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return {
            "memory_total_mb": None,
            "memory_used_mb": None,
            "memory_percent": None,
        }
    total_mb = int(status.ullTotalPhys / 1024 / 1024)
    available_mb = int(status.ullAvailPhys / 1024 / 1024)
    return {
        "memory_total_mb": total_mb,
        "memory_used_mb": total_mb - available_mb,
        "memory_percent": float(status.dwMemoryLoad),
    }


def get_gpu_status() -> dict:
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return {
            "available": False,
            "name": None,
            "utilization_percent": None,
            "memory_used_mb": None,
            "memory_total_mb": None,
            "memory_percent": None,
        }

    command = [
        nvidia_smi,
        "--query-gpu=name,utilization.gpu,memory.used,memory.total",
        "--format=csv,noheader,nounits",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=2)
    except Exception:
        return {"available": False, "name": None, "utilization_percent": None, "memory_used_mb": None, "memory_total_mb": None, "memory_percent": None}
    if completed.returncode != 0 or not completed.stdout.strip():
        return {"available": False, "name": None, "utilization_percent": None, "memory_used_mb": None, "memory_total_mb": None, "memory_percent": None}

    first_line = completed.stdout.strip().splitlines()[0]
    parts = [part.strip() for part in first_line.split(",")]
    if len(parts) < 4:
        return {"available": False, "name": None, "utilization_percent": None, "memory_used_mb": None, "memory_total_mb": None, "memory_percent": None}

    name = parts[0]
    utilization_percent = _parse_float(parts[1])
    memory_used_mb = _parse_float(parts[2])
    memory_total_mb = _parse_float(parts[3])
    memory_percent = None
    if memory_used_mb is not None and memory_total_mb:
        memory_percent = round(memory_used_mb / memory_total_mb * 100, 1)
    return {
        "available": True,
        "name": name,
        "utilization_percent": utilization_percent,
        "memory_used_mb": memory_used_mb,
        "memory_total_mb": memory_total_mb,
        "memory_percent": memory_percent,
    }


def _parse_float(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None
