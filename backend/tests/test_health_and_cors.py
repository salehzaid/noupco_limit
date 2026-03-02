from app.main import app, health


def test_health_handler_returns_ok() -> None:
    assert health() == {"status": "ok"}


def test_cors_allows_localhost_1111_only() -> None:
    cors = next(
        (middleware for middleware in app.user_middleware if middleware.cls.__name__ == "CORSMiddleware"),
        None,
    )
    assert cors is not None

    allow_origins = cors.kwargs.get("allow_origins", [])
    assert set(allow_origins) == {
        "http://localhost:1111",
        "http://127.0.0.1:1111",
    }
