from fastapi import APIRouter

from tts_api.jobs import get_job_store
from tts_api.projects import get_project_store
from tts_api.schemas import TaskEvent, TaskSummary


router = APIRouter()


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
        retryable=project.status == "failed",
        cancelable=False,
        events=[TaskEvent(occurred_at=project.updated_at, stage=stage, message=message, level="error" if project.status == "failed" else "info")],
    )


@router.get("/v1/tasks")
def list_tasks() -> dict:
    speech_tasks = [
        TaskSummary(
            id=job.id,
            source="speech",
            title=f"{job.request.model} · {job.request.input[:42]}",
            status=job.status,
            stage=job.stage,
            progress_percent=job.progress_percent,
            created_at=job.created_at,
            updated_at=job.events[-1].occurred_at if job.events else job.completed_at or job.started_at or job.created_at,
            started_at=job.started_at,
            completed_at=job.completed_at,
            error=job.error,
            log_file=job.log_file,
            retryable=job.status.value in {"failed", "cancelled"},
            cancelable=job.status.value == "queued",
            events=job.events,
        )
        for job in get_job_store().list()
    ]
    batch_tasks = [
        _project_task_summary(project)
        for project in get_project_store().list()
        if project.status.value != "draft"
    ]
    tasks = sorted([*speech_tasks, *batch_tasks], key=lambda task: task.updated_at, reverse=True)
    return {"tasks": [task.model_dump(mode="json") for task in tasks]}
