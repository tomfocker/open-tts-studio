from __future__ import annotations

import copy
import json
import secrets
import threading
from pathlib import Path

from tts_api.doubao_cache import _read_json, _write_json, utc_now_iso


class DoubaoLegacyConfig:
    """Persistent compatibility config used by the original web UI routes."""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "config.json"
        self._lock = threading.RLock()

    @staticmethod
    def defaults() -> dict:
        return {
            "prefetch": {"cacheConcurrent": 20},
            "tts": {"requestDelay": 15, "requestIntervalDelay": 3, "maxRetries": 3},
            "system": {"logLevel": "info"},
            "version": "1.0.0",
            "updatedAt": utc_now_iso(),
        }

    def get_config(self) -> dict:
        with self._lock:
            stored = _read_json(self.path, {})
            stored = stored if isinstance(stored, dict) else {}
            defaults = self.defaults()
            result = {**defaults, **stored}
            for section in ("prefetch", "tts", "system"):
                result[section] = {**defaults[section], **(stored.get(section) or {})}
            if not self.path.exists():
                _write_json(self.path, result)
            return copy.deepcopy(result)

    def update(self, values: dict) -> dict:
        with self._lock:
            config = self.get_config()
            for key, value in values.items():
                if key in {"prefetch", "tts", "system"} and isinstance(value, dict):
                    config[key] = {**config[key], **value}
                elif key not in {"updatedAt"}:
                    config[key] = value
            config["updatedAt"] = utc_now_iso()
            _write_json(self.path, config)
            return copy.deepcopy(config)

    def get_item(self, dotted_path: str, default=None):
        current = self.get_config()
        for part in dotted_path.split("."):
            if not isinstance(current, dict) or part not in current:
                return default
            current = current[part]
        return copy.deepcopy(current)

    def set_item(self, dotted_path: str, value):
        if not dotted_path or any(part in {"", "__proto__", "constructor", "prototype"} for part in dotted_path.split(".")):
            raise ValueError("配置路径无效")
        with self._lock:
            config = self.get_config()
            current = config
            parts = dotted_path.split(".")
            for part in parts[:-1]:
                if not isinstance(current.get(part), dict):
                    current[part] = {}
                current = current[part]
            current[parts[-1]] = value
            config["updatedAt"] = utc_now_iso()
            _write_json(self.path, config)
        return value

    def reset(self) -> dict:
        with self._lock:
            config = self.defaults()
            _write_json(self.path, config)
            return copy.deepcopy(config)


class DoubaoDeviceIdStore:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "device-id.json"
        self._lock = threading.RLock()

    @staticmethod
    def _digits(length: int) -> str:
        return "".join(str(secrets.randbelow(10)) for _ in range(length))

    def _generate(self) -> dict:
        device_id = self._digits(19)
        return {
            "deviceId": device_id,
            "webId": device_id[:10] + self._digits(9),
            "autoGenerate": False,
            "lastUpdated": utc_now_iso(),
        }

    def get(self) -> dict:
        with self._lock:
            payload = _read_json(self.path)
            if not isinstance(payload, dict) or not payload.get("deviceId") or not payload.get("webId"):
                payload = self._generate()
                _write_json(self.path, payload)
            return copy.deepcopy(payload)

    def regenerate(self) -> dict:
        with self._lock:
            payload = self._generate()
            _write_json(self.path, payload)
            return copy.deepcopy(payload)

    def set_auto_generate(self, enabled: bool) -> dict:
        with self._lock:
            payload = self.get()
            payload["autoGenerate"] = bool(enabled)
            payload["lastUpdated"] = utc_now_iso()
            _write_json(self.path, payload)
            return copy.deepcopy(payload)

    def current_ids(self) -> tuple[str, str]:
        payload = self.get()
        if payload.get("autoGenerate"):
            payload = self.regenerate()
        return str(payload["deviceId"]), str(payload["webId"])
