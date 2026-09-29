from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

project = Path(__file__).resolve().parents[1]
archive = project.parent / f"{project.name}-0.1.0.zip"
excluded = {".git", "node_modules", "__pycache__"}

with ZipFile(archive, "w", compression=ZIP_DEFLATED) as output:
    for path in project.rglob("*"):
        if path.is_file() and not any(part in excluded for part in path.relative_to(project).parts):
            output.write(path, arcname=f"{project.name}/{path.relative_to(project).as_posix()}")

print(archive)
