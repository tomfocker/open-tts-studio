from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from tts_api.adapters.gptsovits import shutdown_gptsovits_services
from tts_api.adapters.indextts2_worker import shutdown_indextts2_workers
from tts_api.adapters.voxcpm2 import shutdown_voxcpm2_services
from tts_api.config import get_settings
from tts_api.routes import health, jobs, model_directories, model_instances, model_packages, models, outputs, projects, runtime, settings as settings_routes, speech, system, tasks, voices


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        shutdown_indextts2_workers()
        shutdown_voxcpm2_services()
        shutdown_gptsovits_services()

    app = FastAPI(title="Open TTS Desktop API", version="0.1.0", lifespan=lifespan)
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
    app.include_router(outputs.router)
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
    return app


app = create_app()
