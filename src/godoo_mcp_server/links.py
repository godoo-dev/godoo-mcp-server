"""Build navigation links without exposing credentials or changing Odoo fields."""

from urllib.parse import urlencode, urlsplit, urlunsplit


def public_odoo_url(url: str) -> str | None:
    """Return the configured HTTP base URL with userinfo, query and fragment removed."""
    try:
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            return None
    except ValueError:
        return None
    return urlunsplit(
        (parts.scheme, parts.netloc.rsplit("@", 1)[-1], parts.path.rstrip("/"), "", "")
    )


def record_web_urls(url: str, model: str, ids: list[int]) -> dict[str, str]:
    """Return links keyed by record ID; these links do not imply UI/ACL availability."""
    base = public_odoo_url(url)
    if base is None:
        return {}
    return {
        str(record_id): f"{base}/web#{urlencode({'model': model, 'id': record_id})}"
        for record_id in ids
    }
