from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from tts_api.adapters.gptsovits import shutdown_gptsovits_services
from tts_api.adapters.indextts2_worker import shutdown_indextts2_workers
from tts_api.adapters.sensevoice import shutdown_sensevoice_services
from tts_api.adapters.voxcpm2 import shutdown_voxcpm2_services
from tts_api.adapters.whispera_streaming import shutdown_whispera_streaming_services
from tts_api.config import get_app_version, get_settings
from tts_api.alignment import get_alignment_runner
from tts_api.jobs import get_job_runner
from tts_api.projects import get_project_runner
from tts_api.transcription import get_transcription_runner
from tts_api.enhancement import get_audio_enhancement_runner
from tts_api.separation import get_audio_separation_runner
from tts_api.routes import alignments, audio_assets, doubao, doubao_books, doubao_legacy, doubao_realtime, enhancements, health, jobs, legado, llm, model_directories, model_instances, model_packages, models, outputs, projects, realtime, runtime, separations, settings as settings_routes, speech, system, tasks, transcriptions, voices


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        get_job_runner()
        get_alignment_runner()
        get_project_runner()
        get_transcription_runner()
        get_audio_enhancement_runner()
        get_audio_separation_runner()
        yield
        shutdown_indextts2_workers()
        shutdown_sensevoice_services()
        shutdown_voxcpm2_services()
        shutdown_whispera_streaming_services()
        shutdown_gptsovits_services()

    app = FastAPI(title="Open TTS Desktop API", version=get_app_version(), lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def require_optional_api_key(request: Request, call_next):
        if not settings.api_access_key or request.method == "OPTIONS" or request.url.path in {"/v1/health", "/docs", "/openapi.json"}:
            return await call_next(request)
        bearer_token = request.headers.get("authorization", "").removeprefix("Bearer ")
        provided_key = request.headers.get("x-opentts-key") or request.headers.get("x-open-tts-key") or bearer_token
        if provided_key != settings.api_access_key:
            return JSONResponse(status_code=401, content={"detail": "Missing or invalid OpenTTS API key."})
        return await call_next(request)
    app.include_router(health.router)
    app.include_router(models.router)
    app.include_router(speech.router)
    app.include_router(transcriptions.router)
    app.include_router(enhancements.router)
    app.include_router(separations.router)
    app.include_router(alignments.router)
    app.include_router(realtime.router)
    app.include_router(llm.router)
    app.include_router(outputs.router)
    app.include_router(audio_assets.router)
    app.include_router(jobs.router)
    app.include_router(projects.router)
    app.include_router(voices.router)
    app.include_router(system.router)
    app.include_router(runtime.router)
    app.include_router(settings_routes.router)
    app.include_router(model_directories.router)
    app.include_router(model_instances.router)
    app.include_router(model_packages.router)
    app.include_router(tasks.router)
    app.include_router(doubao.router)
    app.include_router(doubao_books.router)
    app.include_router(doubao_realtime.router)
    app.include_router(legado.router)
    app.include_router(doubao_legacy.router)
    return app


app = create_app()
