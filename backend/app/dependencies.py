"""Shared dependencies."""

from fastapi import Request


def require_admin_key(_: Request) -> None:
    """Temporarily disabled: allow all requests without admin key."""
    return
