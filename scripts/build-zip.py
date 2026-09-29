from pathlib import Path
import json
from zipfile import ZIP_DEFLATED, ZipFile

project = Path(__file__).resolve().parents[1]
version = json.loads((project / "manifest.json").read_text(encoding="utf-8"))["version"]
archive = project.parent / f"{project.name}-{version}.zip"
excluded = {".git", "node_modules", "__pycache__"}

with ZipFile(archive, "w", compression=ZIP_DEFLATED) as output:
    for path in project.rglob("*"):
        if path.is_file() and not any(part in excluded for part in path.relative_to(project).parts):
            output.write(path, arcname=f"{project.name}/{path.relative_to(project).as_posix()}")

print(archive)
