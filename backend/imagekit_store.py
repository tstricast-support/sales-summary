import os
import requests

PRIVATE_KEY = os.getenv("IMAGEKIT_PRIVATE_KEY", "")
FOLDER = os.getenv("IMAGEKIT_FOLDER", "/summary_image_store")


class ImageKitError(Exception):
    pass


def upload_bill(data: bytes, filename: str, name_prefix: str):
    """Uploads one image to ImageKit. Returns (url, file_id)."""
    if not PRIVATE_KEY:
        raise ImageKitError("ImageKit is not configured on the server (IMAGEKIT_PRIVATE_KEY missing)")
    try:
        r = requests.post(
            "https://upload.imagekit.io/api/v1/files/upload",
            auth=(PRIVATE_KEY, ""),
            data={"fileName": f"{name_prefix}-{filename}", "folder": FOLDER, "useUniqueFileName": "true"},
            files={"file": (filename, data)},
            timeout=60,
        )
    except requests.RequestException:
        raise ImageKitError("Could not reach ImageKit. Try again.")
    if not r.ok:
        raise ImageKitError("ImageKit rejected the upload")
    j = r.json()
    return j["url"], j["fileId"]


def delete_file(file_id: str | None):
    """Best-effort delete; never raises."""
    if not file_id or not PRIVATE_KEY:
        return
    try:
        requests.delete(f"https://api.imagekit.io/v1/files/{file_id}", auth=(PRIVATE_KEY, ""), timeout=20)
    except requests.RequestException:
        pass