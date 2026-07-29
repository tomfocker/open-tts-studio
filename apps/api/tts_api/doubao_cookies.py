from __future__ import annotations

import base64
import copy
import ctypes
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CookieSecretCodec:
    prefix = "plain:"

    def protect(self, value: str) -> str:
        return self.prefix + base64.b64encode(value.encode("utf-8")).decode("ascii")

    def unprotect(self, value: str) -> str:
        if value.startswith(self.prefix):
            return base64.b64decode(value.removeprefix(self.prefix)).decode("utf-8")
        return value


class WindowsDpapiCookieSecretCodec(CookieSecretCodec):
    prefix = "dpapi:"

    class _DataBlob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    def _transform(self, value: bytes, *, protect: bool) -> bytes:
        buffer = ctypes.create_string_buffer(value)
        input_blob = self._DataBlob(
            len(value),
            ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)),
        )
        output_blob = self._DataBlob()
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        if protect:
            succeeded = crypt32.CryptProtectData(
                ctypes.byref(input_blob),
                "OpenTTS Doubao Cookie",
                None,
                None,
                None,
                0x1,
                ctypes.byref(output_blob),
            )
        else:
            succeeded = crypt32.CryptUnprotectData(
                ctypes.byref(input_blob),
                None,
                None,
                None,
                None,
                0x1,
                ctypes.byref(output_blob),
            )
        if not succeeded:
            raise OSError(ctypes.get_last_error(), "Windows DPAPI operation failed")
        try:
            return ctypes.string_at(output_blob.pbData, output_blob.cbData)
        finally:
            kernel32.LocalFree(output_blob.pbData)

    def protect(self, value: str) -> str:
        encrypted = self._transform(value.encode("utf-8"), protect=True)
        return self.prefix + base64.b64encode(encrypted).decode("ascii")

    def unprotect(self, value: str) -> str:
        if not value.startswith(self.prefix):
            return value
        encrypted = base64.b64decode(value.removeprefix(self.prefix))
        return self._transform(encrypted, protect=False).decode("utf-8")


def default_secret_codec() -> CookieSecretCodec:
    return WindowsDpapiCookieSecretCodec() if os.name == "nt" else CookieSecretCodec()


class DoubaoCookiePool:
    def __init__(self, path: Path, *, codec: CookieSecretCodec | None = None):
        self.path = path
        self.codec = codec or default_secret_codec()
        self._lock = threading.RLock()
        self._data = self._load()

    @staticmethod
    def _default_data() -> dict:
        return {
            "version": "3.0.0",
            "metadata": {"lastUpdated": _utc_now(), "totalRequests": 0, "totalRotations": 0},
            "config": {
                "rotation": {
                    "strategy": "round-robin",
                    "autoRotate": True,
                    "usageLimitEnabled": True,
                    "usageCountPerCookie": 10,
                    "currentIndex": 0,
                }
            },
            "cookies": [],
        }

    def _load(self) -> dict:
        if not self.path.exists():
            return self._default_data()
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return self._default_data()
        if not isinstance(payload, dict) or not isinstance(payload.get("cookies"), list):
            return self._default_data()
        defaults = self._default_data()
        defaults.update(payload)
        defaults["metadata"] = {**self._default_data()["metadata"], **payload.get("metadata", {})}
        defaults["config"] = copy.deepcopy(self._default_data()["config"])
        defaults["config"]["rotation"].update(payload.get("config", {}).get("rotation", {}))
        for cookie in defaults["cookies"]:
            cookie["value"] = self.codec.unprotect(str(cookie.get("value", "")))
        return defaults

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = copy.deepcopy(self._data)
        payload["metadata"]["lastUpdated"] = _utc_now()
        for cookie in payload["cookies"]:
            cookie["value"] = self.codec.protect(cookie["value"])
        temporary_path = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary_path.replace(self.path)
        if os.name != "nt":
            self.path.chmod(0o600)

    @staticmethod
    def _new_record(*, name: str, value: str, description: str = "") -> dict:
        now = _utc_now()
        return {
            "id": f"cookie_{uuid4().hex}",
            "name": name,
            "value": value,
            "description": description,
            "status": {
                "isActive": False,
                "isValid": True,
                "isDisabled": False,
                "lastValidated": None,
                "validationStatus": "pending",
                "lastError": None,
                "lastFailure": None,
            },
            "usage": {
                "usageCount": 0,
                "lastUsed": None,
                "successCount": 0,
                "failureCount": 0,
            },
            "metadata": {
                "createdAt": now,
                "updatedAt": now,
                "tags": [],
                "priority": 5,
                "weight": 1,
            },
            "limits": {
                "maxUsageCount": 10000,
                "maxRequestsPerMinute": 60,
                "currentMinuteCount": 0,
                "customUsageLimit": 0,
            },
        }

    @staticmethod
    def _public(record: dict, *, include_value: bool) -> dict:
        result = copy.deepcopy(record)
        if include_value:
            return result
        value = result.pop("value", "")
        result["hasValue"] = bool(value)
        result["valuePreview"] = f"{value[:10]}…" if value else ""
        return result

    def list(self, *, include_values: bool = False) -> list[dict]:
        with self._lock:
            return [self._public(record, include_value=include_values) for record in self._data["cookies"]]

    def get(self, cookie_id: str, *, include_value: bool = False) -> dict | None:
        with self._lock:
            record = self._find(cookie_id)
            return self._public(record, include_value=include_value) if record else None

    def add(self, *, name: str, value: str, description: str = "") -> dict:
        name = name.strip()
        value = value.strip()
        if not name or not value:
            raise ValueError("Cookie名称和值不能为空")
        if len(name) > 100 or len(value) > 10000 or len(description) > 500:
            raise ValueError("Cookie字段长度超出限制")
        with self._lock:
            if any(record["name"] == name for record in self._data["cookies"]):
                raise ValueError("Cookie名称已存在")
            record = self._new_record(name=name, value=value, description=description)
            if not self._data["cookies"]:
                record["status"]["isActive"] = True
            self._data["cookies"].append(record)
            self._save()
            return self._public(record, include_value=False)

    def update(self, cookie_id: str, values: dict) -> dict:
        with self._lock:
            record = self._require(cookie_id)
            name = str(values.get("name", record["name"])).strip()
            value = str(values.get("value", record["value"])).strip()
            description = str(values.get("description", record["description"])).strip()
            if not name or not value:
                raise ValueError("Cookie名称和值不能为空")
            if any(item["id"] != cookie_id and item["name"] == name for item in self._data["cookies"]):
                raise ValueError("Cookie名称已存在")
            record.update({"name": name, "value": value, "description": description})
            record["metadata"]["updatedAt"] = _utc_now()
            self._save()
            return self._public(record, include_value=False)

    def delete(self, cookie_id: str) -> None:
        with self._lock:
            record = self._require(cookie_id)
            was_active = record["status"]["isActive"]
            self._data["cookies"].remove(record)
            if was_active:
                available = self._available()
                if available:
                    available[0]["status"]["isActive"] = True
            self._save()

    def clear(self) -> int:
        with self._lock:
            count = len(self._data["cookies"])
            self._data = self._default_data()
            self._save()
            return count

    def select(self) -> dict | None:
        with self._lock:
            available = self._available()
            if not available:
                return None
            active = next((record for record in available if record["status"]["isActive"]), None)
            if active is None:
                active = available[self._rotation()["currentIndex"] % len(available)]
                self._set_active(active)
                self._save()
            limit = int(self._rotation().get("usageCountPerCookie", 10))
            if self._rotation().get("usageLimitEnabled", True) and limit > 0:
                if active["usage"]["usageCount"] > 0 and active["usage"]["usageCount"] % limit == 0:
                    active = self._rotate_locked(available)
            return copy.deepcopy(active)

    def rotate(self, cookie_id: str | None = None) -> dict | None:
        with self._lock:
            available = self._available()
            if not available:
                return None
            if cookie_id:
                selected = next((record for record in available if record["id"] == cookie_id), None)
                if selected is None:
                    raise KeyError(cookie_id)
                self._set_active(selected)
                self._data["metadata"]["totalRotations"] += 1
            else:
                selected = self._rotate_locked(available)
            self._save()
            return self._public(selected, include_value=False)

    def configure_rotation(self, *, usage_limit_enabled: bool, usage_count_per_cookie: int) -> dict:
        if not 1 <= usage_count_per_cookie <= 1000:
            raise ValueError("每个 Cookie 的使用次数必须在 1 到 1000 之间")
        with self._lock:
            rotation = self._rotation()
            rotation["usageLimitEnabled"] = usage_limit_enabled
            rotation["usageCountPerCookie"] = usage_count_per_cookie
            self._save()
            return copy.deepcopy(rotation)

    def mark_validation(self, cookie_id: str, *, valid: bool, message: str) -> dict:
        with self._lock:
            record = self._require(cookie_id)
            now = _utc_now()
            record["status"].update(
                {
                    "isValid": valid,
                    "lastValidated": now,
                    "validationStatus": "valid" if valid else "invalid",
                    "lastError": None if valid else message,
                    "lastFailure": None if valid else now,
                }
            )
            if not valid:
                record["status"]["isActive"] = False
            self._save()
            return self._public(record, include_value=False)

    def set_disabled(self, cookie_id: str, disabled: bool) -> dict:
        with self._lock:
            record = self._require(cookie_id)
            record["status"]["isDisabled"] = disabled
            if disabled:
                record["status"]["isActive"] = False
            elif not any(item["status"]["isActive"] for item in self._available()):
                self._set_active(record)
            self._save()
            return self._public(record, include_value=False)

    def set_usage_limit(self, cookie_id: str, limit: int) -> dict:
        if not 0 <= limit <= 10000:
            raise ValueError("限制次数必须是0-10000之间的整数（0表示不限制）")
        with self._lock:
            record = self._require(cookie_id)
            record["limits"]["customUsageLimit"] = limit
            record["metadata"]["updatedAt"] = _utc_now()
            self._save()
            return self._public(record, include_value=False)

    def record_usage(self, cookie_id: str, *, success: bool, error: str | None = None) -> None:
        with self._lock:
            record = self._require(cookie_id)
            record["usage"]["usageCount"] += 1
            record["usage"]["lastUsed"] = _utc_now()
            key = "successCount" if success else "failureCount"
            record["usage"][key] += 1
            record["status"]["lastError"] = None if success else error
            self._data["metadata"]["totalRequests"] += 1
            self._save()

    def stats(self) -> dict:
        with self._lock:
            records = self._data["cookies"]
            available = self._available()
            valid = [record for record in available if record["status"]["isValid"]]
            active = next((record for record in available if record["status"]["isActive"]), None)
            success = sum(record["usage"]["successCount"] for record in records)
            failures = sum(record["usage"]["failureCount"] for record in records)
            return {
                "total": len(records),
                "enabled": len(available),
                "disabled": len(records) - len(available),
                "valid": len(valid),
                "invalid": len(available) - len(valid),
                "active": {"id": active["id"], "name": active["name"]} if active else None,
                "totalRequests": self._data["metadata"]["totalRequests"],
                "totalRotations": self._data["metadata"]["totalRotations"],
                "averageSuccessRate": success / (success + failures) if success + failures else 1.0,
                "lastUpdated": self._data["metadata"]["lastUpdated"],
                "rotation": copy.deepcopy(self._rotation()),
            }

    def _rotation(self) -> dict:
        return self._data["config"]["rotation"]

    def _find(self, cookie_id: str) -> dict | None:
        return next((record for record in self._data["cookies"] if record["id"] == cookie_id), None)

    def _require(self, cookie_id: str) -> dict:
        record = self._find(cookie_id)
        if record is None:
            raise KeyError(cookie_id)
        return record

    def _available(self) -> list[dict]:
        return [
            record
            for record in self._data["cookies"]
            if not record["status"]["isDisabled"] and record["status"]["isValid"]
        ]

    def _set_active(self, selected: dict) -> None:
        for record in self._data["cookies"]:
            record["status"]["isActive"] = record is selected
        selected["usage"]["lastUsed"] = _utc_now()
        available = self._available()
        if selected in available:
            self._rotation()["currentIndex"] = available.index(selected)

    def _rotate_locked(self, available: list[dict]) -> dict:
        active_index = next(
            (index for index, record in enumerate(available) if record["status"]["isActive"]),
            int(self._rotation().get("currentIndex", 0)) % len(available),
        )
        selected = available[(active_index + 1) % len(available)]
        self._set_active(selected)
        self._data["metadata"]["totalRotations"] += 1
        return selected
