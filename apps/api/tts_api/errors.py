from fastapi import HTTPException


def unknown_model_error(model_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Unknown model: {model_id}")


def unsupported_adapter_error(adapter: str) -> HTTPException:
    return HTTPException(status_code=501, detail=f"Unsupported adapter: {adapter}")
