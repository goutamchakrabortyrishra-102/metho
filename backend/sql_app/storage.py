from pathlib import Path
import os


BACKEND_ROOT_DIR = Path(__file__).resolve().parents[1]


def _resolve_upload_root() -> Path:
    explicit_root = (os.getenv("METHO_UPLOAD_ROOT") or os.getenv("UPLOADED_OBJECTS_DIR") or "").strip()
    if explicit_root:
        return Path(explicit_root)

    render_disk_path = (
        os.getenv("RENDER_DISK_PATH")
        or os.getenv("RENDER_DISK_MOUNT_PATH")
        or ""
    ).strip()
    if render_disk_path:
        mount_root = Path(render_disk_path)
        # Some deployments store files directly under mount root (e.g. /var/data/product_images),
        # others under /uploaded_objects.
        for candidate in (mount_root / "uploaded_objects", mount_root):
            try:
                if candidate.exists() and candidate.is_dir():
                    return candidate
            except Exception:
                continue
        return mount_root / "uploaded_objects"

    # Auto-detect common persistent mount paths used on Render/Docker setups.
    # Prefer an already-populated directory to avoid reading/writing to ephemeral paths.
    for root in [
        Path("/var/data"),
        Path("/var/data/uploaded_objects"),
        Path("/data"),
        Path("/data/uploaded_objects"),
    ]:
        try:
            if root.exists() and root.is_dir():
                return root
        except Exception:
            continue

    return BACKEND_ROOT_DIR / "uploaded_objects"


UPLOADED_OBJECTS_DIR = _resolve_upload_root()
UPLOADED_OBJECTS_DIR.mkdir(parents=True, exist_ok=True)
