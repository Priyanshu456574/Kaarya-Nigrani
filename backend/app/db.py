import os
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

ROOT = Path(__file__).resolve().parents[1]
DB_URL = os.environ.get("KN_DB_URL", f"sqlite:///{ROOT / 'kaarya.db'}")
MEDIA_DIR = Path(os.environ.get("KN_MEDIA_DIR", ROOT / "media"))
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})


def migrate():
    """Additive migration: create new tables, add new nullable/defaulted columns to existing ones.
    Nothing is dropped or rewritten. (A pilot should move to Alembic; see PILOT_READINESS.md.)"""
    insp = inspect(engine)
    existing = set(insp.get_table_names())
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in existing:
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl_type = col.type.compile(engine.dialect)
                default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
                if isinstance(default, bool):
                    default = int(default)
                dflt = f" DEFAULT {default!r}" if default is not None else ""
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl_type}{dflt}'))


def init_db():
    from . import models  # noqa: F401
    SQLModel.metadata.create_all(engine)
    migrate()


def get_session():
    with Session(engine) as session:
        yield session
