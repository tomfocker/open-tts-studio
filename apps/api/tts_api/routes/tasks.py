from pathlib import Path

from fastapi import APIRouter

from tts_api.alignment import get_alignment_store
from tts_api.jobs import get_job_store
from tts_api.projects import get_project_store
from tts_api.schemas import TaskEvent, TaskResult, TaskSummary
from tts_api.transcription import get_transcription_store
from tts_api.enhancement import get_audio_enhancement_store
from tts_api.separation import get_audio_separation_store


router = APIRouter()


def _file_result(
    result_id: str,
    kind: str,
    label: str,
    file_path: str,
    url: str | None = None,
    *,
    model: str | None = None,
    text: str | None = None,
    duration_seconds: float | None = None,
) -> TaskResult:
    path = Path(file_path)
    try:
        exists = path.is_file()
        size_bytes = path.stat().st_size if exists else None
    except OSError:
        exists = False
        size_bytes = None
    suffix = path.suffix.lower()
    mime_type = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".txt": "text/plain",
        ".srt": "application/x-subrip",
        ".json": "application/json",
    }.get(suffix)
    return TaskResult(
        id=result_id,
        kind=kind,
        label=label,
        file_name=path.name,
        file_path=str(path),
        url=url,
        mime_type=mime_type,
        size_bytes=size_bytes,
        duration_seconds=duration_seconds,
        model=model,
        text=text,
        exists=exists,
        downloadable=exists,
    )


def _virtual_result(
    result_id: str,
    kind: str,
    label: str,
    file_name: str,
    url: str,
    *,
    text: str | None = None,
    mime_type: str | None = None,
) -> TaskResult:
    return TaskResult(
        id=result_id,
        kind=kind,
        label=label,
        file_name=file_name,
        url=url,
        mime_type=mime_type,
        text=text,
        exists=True,
        downloadable=True,
    )


def _speech_results(job) -> list[TaskResult]:
    if job.result is None:
        return []
    results = [
        _file_result(
            f"speech:{job.id}:audio",
            "audio",
            "实时回复音频" if job.source == "realtime" else "语音成品",
            job.result.file_path,
            job.result.audio_url,
            model=job.result.model,
            text=job.request.input,
            duration_seconds=job.result.duration_seconds,
        )
    ]
    if job.result.alignment_url:
        results.append(
            _virtual_result(
                f"speech:{job.id}:alignment",
                "alignment",
                "强制对齐时间轴",
                f"alignment-{job.id[:8]}.json",
                job.result.alignment_url,
                mime_type="application/json",
            )
        )
    return results


def _project_task_summary(project) -> TaskSummary:
    total = len(project.segments)
    completed = sum(segment.status == "succeeded" for segment in project.segments)
    failed_segments = [segment for segment in project.segments if segment.status == "failed"]
    running_segment = next((segment for segment in project.segments if segment.status == "running"), None)
    if project.status == "queued":
        stage = "waiting_batch_queue"
        message = "项目已进入串行生成队列。"
    elif project.status == "running":
        stage = "batch_segment"
        position = running_segment.position if running_segment else min(total, completed + len(failed_segments) + 1)
        message = f"正在生成第 {position}/{total} 段。"
    elif project.status == "cancelling":
        stage = "stopping_after_segment"
        message = "已收到停止请求；当前段落完成后将安全停止。"
    elif project.status == "cancelled":
        stage = "cancelled"
        message = "项目已安全停止；已完成段落会保留，可继续生成。"
    elif project.status == "failed":
        stage = "failed"
        message = failed_segments[0].error if failed_segments else "项目生成失败。"
    else:
        stage = "completed"
        message = "批量项目已完成。"
    progress = 100 if project.status == "completed" else int(((completed + len(failed_segments)) / total) * 100) if total else 0
    return TaskSummary(
        id=f"project:{project.id}",
        source="batch_project",
        title=project.title,
        status=project.status,
        stage=stage,
        progress_percent=progress,
        created_at=project.created_at,
        updated_at=project.updated_at,
        started_at=project.started_at,
        completed_at=project.completed_at,
        error=failed_segments[0].error if failed_segments else None,
        retryable=project.status.value in {"failed", "cancelled"},
        cancelable=project.status.value in {"queued", "running"},
        events=[TaskEvent(occurred_at=project.updated_at, stage=stage, message=message, level="error" if project.status == "failed" else "info")],
        results=[
            _file_result(
                f"project:{project.id}:segment:{segment.id}",
                "audio",
                f"第 {segment.position} 段",
                segment.result.file_path,
                segment.result.audio_url,
                model=segment.result.model,
                text=segment.text,
                duration_seconds=segment.result.duration_seconds,
            )
            for segment in project.segments
            if segment.result is not None
        ],
    )


@router.get("/v1/tasks")
def list_tasks() -> dict:
    speech_tasks = [
        TaskSummary(
            id=job.id,
            source=job.source,
            title=(f"实时对话 · {job.request.input[:42]}" if job.source == "realtime" else f"{job.request.model} · {job.request.input[:42]}"),
            status=job.status,
            stage=job.stage,
            progress_percent=job.progress_percent,
            created_at=job.created_at,
            updated_at=job.events[-1].occurred_at if job.events else job.completed_at or job.started_at or job.created_at,
            started_at=job.started_at,
            completed_at=job.completed_at,
            error=job.error,
            log_file=job.log_file,
            retryable=job.source != "realtime" and job.status.value in {"failed", "cancelled"},
            cancelable=job.source != "realtime" and job.status.value in {"queued", "running"},
            events=job.events,
            results=_speech_results(job),
        )
        for job in get_job_store().list()
    ]
    batch_tasks = [
        _project_task_summary(project)
        for project in get_project_store().list()
        if project.status.value != "draft"
    ]
    alignment_tasks = [
        TaskSummary(
            id=f"alignment:{job.id}",
            source="alignment",
            title="旁白本地 ASR / 强制对齐",
            status=job.status,
            stage=job.status,
            progress_percent=100 if job.status.value == "completed" else 0,
            created_at=job.created_at,
            updated_at=job.completed_at or job.started_at or job.created_at,
            started_at=job.started_at,
            completed_at=job.completed_at,
            error=job.error,
            retryable=job.status.value in {"failed", "cancelled"},
            cancelable=job.status.value in {"queued", "running"},
            events=[],
            results=(
                [
                    _virtual_result(
                        f"alignment:{job.id}:timeline",
                        "alignment",
                        "强制对齐时间轴",
                        f"alignment-{job.id[:8]}.json",
                        job.alignment_url,
                        mime_type="application/json",
                    )
                ]
                if job.status.value == "completed"
                else []
            ),
        )
        for job in get_alignment_store().list()
    ]
    transcription_tasks = [
        TaskSummary(
            id=f"transcription:{job.id}",
            source="transcription",
            title=f"音视频转写 · {job.source_file_name}",
            status=job.status,
            stage=job.stage,
            progress_percent=job.progress_percent,
            created_at=job.created_at,
            updated_at=job.completed_at or job.started_at or job.created_at,
            started_at=job.started_at,
            completed_at=job.completed_at,
            error=job.error,
            retryable=job.status.value in {"failed", "cancelled"},
            cancelable=job.status.value in {"queued", "running"},
            events=[],
            results=(
                [
                    _virtual_result(
                        f"transcription:{job.id}:export",
                        "subtitle" if job.output_format.value == "srt" else "transcript",
                        "SRT 字幕" if job.output_format.value == "srt" else "TXT 转写",
                        f"{Path(job.source_file_name).stem}.{job.output_format.value}",
                        f"/v1/transcriptions/{job.id}/export.{job.output_format.value}",
                        text=job.text,
                        mime_type="application/x-subrip" if job.output_format.value == "srt" else "text/plain",
                    )
                ]
                if job.status.value == "completed" and job.text
                else []
            ),
        )
        for job in get_transcription_store().list()
    ]
    enhancement_tasks = [
        TaskSummary(
            id=f"audio-enhancement:{job.id}",
            source="audio_enhancement",
            title=f"语音增强 · {job.source_file_name}",
            status=job.status,
            stage=job.stage,
            progress_percent=job.progress_percent,
            created_at=job.created_at,
            updated_at=job.completed_at or job.started_at or job.created_at,
            started_at=job.started_at,
            completed_at=job.completed_at,
            error=job.error,
            retryable=job.status.value in {"failed", "cancelled"},
            cancelable=job.status.value in {"queued", "running"},
            events=[],
            results=[
                _file_result(
                    f"audio-enhancement:{job.id}:{index}",
                    "enhancement",
                    f"增强 · {output.model}",
                    output.file_path,
                    output.audio_url,
                    model=output.model,
                    duration_seconds=output.duration_seconds,
                )
                for index, output in enumerate(job.outputs)
            ],
        )
        for job in get_audio_enhancement_store().list()
    ]
    separation_tasks = [
        TaskSummary(
            id=f"audio-separation:{job.id}",
            source="audio_separation",
            title=f"人声伴奏分轨 · {job.source_file_name}",
            status=job.status,
            stage=job.stage,
            progress_percent=job.progress_percent,
            created_at=job.created_at,
            updated_at=job.completed_at or job.started_at or job.created_at,
            started_at=job.started_at,
            completed_at=job.completed_at,
            error=job.error,
            retryable=job.status.value in {"failed", "cancelled"},
            cancelable=job.status.value in {"queued", "running"},
            events=[],
            results=[
                _file_result(
                    f"audio-separation:{job.id}:{output.stem}",
                    "separation",
                    "人声" if output.stem == "vocals" else "伴奏",
                    output.file_path,
                    output.audio_url,
                    model=job.model_display_name,
                    duration_seconds=output.duration_seconds,
                )
                for output in job.outputs
            ],
        )
        for job in get_audio_separation_store().list()
    ]
    tasks = sorted([*speech_tasks, *alignment_tasks, *batch_tasks, *transcription_tasks, *enhancement_tasks, *separation_tasks], key=lambda task: task.updated_at, reverse=True)
    return {"tasks": [task.model_dump(mode="json") for task in tasks]}
