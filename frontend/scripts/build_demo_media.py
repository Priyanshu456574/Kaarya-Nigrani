"""Pack the demo photos into the serverless bundle as small data URIs (so publishing never adds files)."""
import base64, io, json, pathlib, sys
from PIL import Image

media = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "../backend/media")
out = {}
for f in sorted(media.glob("*.jpg")):
    im = Image.open(f).convert("RGB")
    im.thumbnail((480, 320))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=72, optimize=True)
    out[f.name] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
path = pathlib.Path(__file__).resolve().parents[1] / "src" / "demo" / "media.json"
path.write_text(json.dumps(out, separators=(",", ":")))
print(len(out), "photos,", path.stat().st_size // 1024, "KB")
