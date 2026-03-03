from app.main import app, health, _get_allowed_origin_regex, _get_allowed_origins


def test_health_handler_returns_ok() -> None:
    assert health() == {"status": "ok"}


def test_cors_uses_configured_allowed_origins() -> None:
    cors = next(
        (middleware for middleware in app.user_middleware if middleware.cls.__name__ == "CORSMiddleware"),
        None,
    )
    assert cors is not None

    allow_origins = cors.kwargs.get("allow_origins", [])
    assert allow_origins == _get_allowed_origins()


def test_allowed_origins_default_when_unset(monkeypatch) -> None:
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert _get_allowed_origins() == [
        "http://localhost:1111",
        "http://127.0.0.1:1111",
    ]


def test_allowed_origins_read_from_env(monkeypatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", " https://noupco-limit.vercel.app ,https://example.com ,, ")
    assert _get_allowed_origins() == [
        "https://noupco-limit.vercel.app",
        "https://example.com",
    ]


def test_allowed_origin_regex_from_env(monkeypatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGIN_REGEX", r"https://noupco-limit-.*\.vercel\.app")
    assert _get_allowed_origin_regex() == r"https://noupco-limit-.*\.vercel\.app"


def test_allowed_origin_regex_empty_when_unset(monkeypatch) -> None:
    monkeypatch.delenv("ALLOWED_ORIGIN_REGEX", raising=False)
    assert _get_allowed_origin_regex() is None
