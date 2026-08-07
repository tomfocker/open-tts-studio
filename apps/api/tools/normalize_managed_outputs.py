"""Normalize managed output files and remove known upgrade/test residue.

This is intentionally an opt-in maintenance command.  Without ``--apply`` it
only prints the planned repairs.  It repairs references before deleting any
legacy ``.migrated*`` copies, and it never touches models or runtime folders.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any


OUTPUT_TITLE_MAX_LENGTH = 48
INVALID_WINDOWS_FILE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
MIGRATED_SUFFIX = re.compile(r"\.migrated(?:-\d+)?$")
OUTPUT_FILENAME = re.compile(r"^\d{8}-\d{6}-.+?(?:-\d{2})?\.[^.]+$")

CONFIG_FILES = (
    "config/tasks.json",
    "config/alignments.json",
    "config/transcriptions.json",
    "config/audio-enhancements.json",
    "audio-separations/jobs.json",
    "config/voices.json",
)

KNOWN_TEST_DIRECTORIES = (
    "test-temp",
    "bilibili-audio-smoke",
    "bilibili-video-smoke",
    "bilibili-preview-user-data",
    "bilibili-login-test-user-data",
    "sensevoice-smoke",
)
KNOWN_OLD_ARCHIVES = (
    "archive/v0.8.10-electron-profile",
    "archive/v0.8.10-preclean-20260804-025804",
)


def parse_args() -> argparse.Namespace:
    default_root = os.environ.get("OPEN_TTS_STORAGE_ROOT") or (
        r"D:\open-tts" if os.name == "nt" else str(Path.cwd())
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(default_root))
    parser.add_argument("--apply", action="store_true", help="perform the planned migration")
    parser.add_argument("--cleanup", action="store_true", help="remove known test directories and leftover .migrated files")
    return parser.parse_args()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def migrated_candidates(path: Path) -> list[Path]:
    candidates: list[Path] = []
    first = Path(f"{path}.migrated")
    if first.exists():
        candidates.append(first)
    for index in range(1, 1000):
        candidate = Path(f"{path}.migrated-{index}")
        if candidate.exists():
            candidates.append(candidate)
    return candidates


def resolve_existing(path: Path) -> Path | None:
    if path.is_file():
        return path
    candidates = migrated_candidates(path)
    return candidates[0] if candidates else None


def strip_migrated_suffix(name: str) -> str:
    return MIGRATED_SUFFIX.sub("", name)


def output_extension(path: Path) -> str:
    return Path(strip_migrated_suffix(path.name)).suffix.lower() or ".bin"


def output_title(value: str | None, *, first_sentence: bool = False, fallback: str = "未命名") -> str:
    normalized = re.sub(r"\s+", " ", value or "")
    if "\ufffd" in normalized or normalized.count("?") >= 2 or re.fullmatch(r"[0-9a-f]{24,}", normalized, re.IGNORECASE):
        return fallback
    if first_sentence:
        match = re.search(r"[。！？!?；;]", normalized)
        if match:
            normalized = normalized[: match.start()]
    normalized = INVALID_WINDOWS_FILE_CHARS.sub("_", normalized).strip(" ._")
    return normalized[:OUTPUT_TITLE_MAX_LENGTH] or fallback


def is_normalized_hash_name(path: Path) -> bool:
    stem = strip_migrated_suffix(path.name)
    match = re.match(r"^\d{8}-\d{6}-(.+?)(?:-\d{2})?\.[^.]+$", stem)
    return bool(match and re.fullmatch(r"[0-9a-f]{24,}", match.group(1), re.IGNORECASE))


def task_timestamp(path: Path, item: dict[str, Any]) -> str:
    # Preserve the actual file time where possible.  It survives the previous
    # cross-drive copy and is more accurate than a later migration timestamp.
    try:
        return datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y%m%d-%H%M%S")
    except OSError:
        for key in ("completed_at", "created_at"):
            value = item.get(key)
            if isinstance(value, str):
                try:
                    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone().strftime("%Y%m%d-%H%M%S")
                except ValueError:
                    pass
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Normalizer:
    def __init__(self, root: Path, apply: bool, cleanup: bool) -> None:
        self.root = root.resolve()
        self.data = self.root / "data"
        self.outputs = self.data / "outputs"
        self.apply = apply
        self.cleanup = cleanup
        self.path_map: dict[Path, Path] = {}
        self.output_moves: list[tuple[Path, Path]] = []
        self.input_repairs: list[tuple[Path, Path]] = []
        self.removed_files: list[Path] = []
        self.removed_directories: list[Path] = []
        self.payloads: dict[Path, Any] = {}
        self.reserved: set[Path] = set()

    def load_payloads(self) -> None:
        for relative in CONFIG_FILES:
            path = self.data / relative
            if path.exists():
                self.payloads[path] = load_json(path)

    def register_path(self, requested: Path, actual: Path, target: Path) -> None:
        self.path_map[requested.resolve()] = target.resolve()
        self.path_map[actual.resolve()] = target.resolve()

    def next_output(self, source: Path, title: str, item: dict[str, Any], first_sentence: bool, fallback: str) -> Path:
        base = f"{task_timestamp(source, item)}-{output_title(title, first_sentence=first_sentence, fallback=fallback)}"
        extension = output_extension(source)
        candidate = self.outputs / f"{base}{extension}"
        sequence = 2
        while candidate.exists() or candidate in self.reserved:
            candidate = self.outputs / f"{base}-{sequence:02d}{extension}"
            sequence += 1
        self.reserved.add(candidate.resolve())
        return candidate

    def register_output(self, requested_value: str, title: str, item: dict[str, Any], first_sentence: bool, fallback: str) -> None:
        requested = Path(requested_value).expanduser()
        actual = resolve_existing(requested)
        if actual is None:
            return
        known_target = self.path_map.get(requested.resolve()) or self.path_map.get(actual.resolve())
        if known_target is not None:
            self.path_map[requested.resolve()] = known_target
            self.path_map[actual.resolve()] = known_target
            return
        # A current, already-normalized file can remain where it is.
        if actual.parent.resolve() == self.outputs.resolve() and OUTPUT_FILENAME.match(actual.name) and not is_normalized_hash_name(actual):
            self.register_path(requested, actual, actual)
            self.reserved.add(actual.resolve())
            return
        target = self.next_output(actual, title, item, first_sentence, fallback)
        self.register_path(requested, actual, target)
        self.output_moves.append((actual, target))

    def repair_input(self, directory: Path, input_id: str | None, source_name: str | None) -> None:
        if not input_id or not source_name:
            return
        extension = Path(source_name).suffix.lower()
        if not extension:
            return
        requested = directory / f"{input_id.replace('-', '').lower()}{extension}"
        if requested.exists():
            return
        actual = resolve_existing(requested)
        if actual is not None:
            self.input_repairs.append((actual, requested))

    def collect(self) -> None:
        self.load_payloads()
        tasks = self.payloads.get(self.data / "config/tasks.json", {}).get("jobs", [])
        for job in tasks:
            result = job.get("result") or {}
            file_path = result.get("file_path")
            request = job.get("request") or {}
            if isinstance(file_path, str):
                self.register_output(file_path, str(request.get("input") or "历史语音"), job, True, "历史语音")

        enhancements = self.payloads.get(self.data / "config/audio-enhancements.json", {}).get("audio_enhancements", [])
        for job in enhancements:
            for result in job.get("outputs") or []:
                if isinstance(result.get("file_path"), str):
                    self.register_output(result["file_path"], Path(job.get("source_file_name") or "历史增强").stem, job, False, "历史增强")

        separations = self.payloads.get(self.data / "audio-separations/jobs.json", {}).get("audio_separations", [])
        for job in separations:
            for result in job.get("outputs") or []:
                if isinstance(result.get("file_path"), str):
                    self.register_output(result["file_path"], Path(job.get("source_file_name") or "历史分轨").stem, job, False, "历史分轨")

        transcriptions = self.payloads.get(self.data / "config/transcriptions.json", {}).get("transcriptions", [])
        # Completed transcription records retain their text and exports; their
        # old multi-gigabyte input copies are deliberately not restored.
        _ = transcriptions
        for payload in self.payloads.values():
            self.collect_voice_references(payload)

    def collect_voice_references(self, payload: Any) -> None:
        if isinstance(payload, dict):
            for key, value in payload.items():
                if key in {"reference_audio", "original_reference_audio"} and isinstance(value, str):
                    requested = Path(value)
                    actual = resolve_existing(requested)
                    if actual is None:
                        continue
                    try:
                        relative = actual.resolve().relative_to((self.data / "voices").resolve())
                    except ValueError:
                        if requested.resolve().is_relative_to(self.outputs.resolve()):
                            self.register_output(value, "音色参考", {}, False, "历史音色")
                        continue
                    if actual != requested and self.apply:
                        requested.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(actual), str(requested))
                    elif actual != requested:
                        repair = (actual, requested)
                        if repair not in self.input_repairs:
                            self.input_repairs.append(repair)
                else:
                    self.collect_voice_references(value)
        elif isinstance(payload, list):
            for item in payload:
                self.collect_voice_references(item)

    def replace_path_value(self, value: str) -> str:
        try:
            mapped = self.path_map.get(Path(value).expanduser().resolve())
        except OSError:
            mapped = None
        return str(mapped) if mapped else value

    def replace_audio_url(self, value: str) -> str:
        if not value.startswith("/outputs/"):
            return value
        old_path = self.outputs / value.removeprefix("/outputs/")
        mapped = self.path_map.get(old_path.resolve())
        return f"/outputs/{mapped.name}" if mapped else value

    def rewrite(self, payload: Any, key: str | None = None) -> Any:
        if isinstance(payload, dict):
            return {k: self.rewrite(v, k) for k, v in payload.items()}
        if isinstance(payload, list):
            return [self.rewrite(v, key) for v in payload]
        if isinstance(payload, str):
            if key == "audio_url":
                return self.replace_audio_url(payload)
            if key in {"file_path", "reference_audio", "original_reference_audio"}:
                return self.replace_path_value(payload)
        return payload

    def apply_moves(self) -> None:
        for source, target in self.input_repairs:
            if source.resolve() == target.resolve() or not source.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if sha256(source) == sha256(target):
                    source.unlink()
                    continue
                raise RuntimeError(f"输入文件冲突，拒绝覆盖：{target}")
            shutil.move(str(source), str(target))
        for source, target in self.output_moves:
            if source.resolve() == target.resolve() or not source.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if sha256(source) == sha256(target):
                    source.unlink()
                    continue
                raise RuntimeError(f"成果文件冲突，拒绝覆盖：{target}")
            shutil.move(str(source), str(target))

    def cleanup_residue(self) -> None:
        if not self.cleanup:
            return
        for relative in KNOWN_TEST_DIRECTORIES:
            path = self.data / relative
            if path.exists():
                self.removed_directories.append(path)
                if self.apply:
                    shutil.rmtree(path)
        for relative in KNOWN_OLD_ARCHIVES:
            path = self.data / relative
            if path.exists():
                self.removed_directories.append(path)
                if self.apply:
                    shutil.rmtree(path)
        archive_root = self.data / "archive"
        for path in self.data.rglob("*"):
            if not path.is_file() or archive_root in path.parents:
                continue
            if ".migrated" in path.name:
                self.removed_files.append(path)
                if self.apply:
                    path.unlink()
        if self.apply:
            for path in sorted(self.data.rglob("*"), reverse=True):
                if path.is_dir() and path != self.data:
                    try:
                        path.rmdir()
                    except OSError:
                        pass

    def run(self) -> None:
        self.collect()
        print(f"输出迁移计划：{len(self.output_moves)} 个")
        print(f"输入修复计划：{len(self.input_repairs)} 个")
        if self.cleanup:
            residue = [p for p in self.data.rglob("*") if p.is_file() and ".migrated" in p.name and (self.data / "archive") not in p.parents]
            print(f"待清理迁移残留：{len(residue)} 个")
            print(f"待清理测试目录：{sum((self.data / d).exists() for d in KNOWN_TEST_DIRECTORIES)} 个")
        if not self.apply:
            for source, target in self.output_moves[:20]:
                print(f"  {source.name} -> {target.name}")
            return
        backup = self.data / "archive" / f"normalize-outputs-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        backup.mkdir(parents=True, exist_ok=True)
        for path in self.payloads:
            target = backup / path.relative_to(self.data)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        self.apply_moves()
        for path, payload in self.payloads.items():
            dump_json(path, self.rewrite(payload))
        self.cleanup_residue()
        print(f"已备份配置：{backup}")
        print(f"已删除残留文件：{len(self.removed_files)} 个")
        print(f"已删除测试目录：{len(self.removed_directories)} 个")


def main() -> None:
    args = parse_args()
    Normalizer(args.root, args.apply, args.cleanup).run()


if __name__ == "__main__":
    main()
