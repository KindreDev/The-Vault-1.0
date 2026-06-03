from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
import sys
import json


def _get_config_dir() -> str:
    """
    Fixed, always-writable directory where vault_config.json lives.
    This location NEVER changes — it's the anchor point for everything else.
    - Frozen: %APPDATA%\\TheVault\\
    - Dev:    backend/
    """
    if getattr(sys, 'frozen', False):
        app_data = os.environ.get('APPDATA', os.path.expanduser('~'))
        d = os.path.join(app_data, 'TheVault')
        os.makedirs(d, exist_ok=True)
        return d
    return os.path.dirname(os.path.abspath(__file__))


CONFIG_DIR  = _get_config_dir()
CONFIG_FILE = os.path.join(CONFIG_DIR, 'vault_config.json')


def _read_config() -> dict:
    try:
        if os.path.isfile(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _get_data_dir() -> str:
    """
    Returns the writable data directory for vault.db and thumbs/.
    Uses the path stored in vault_config.json if set, otherwise falls
    back to CONFIG_DIR (AppData on exe, backend/ in dev).
    """
    config = _read_config()
    custom = config.get('data_dir', '').strip()
    if custom:
        try:
            os.makedirs(custom, exist_ok=True)
        except Exception:
            pass  # drive may not be mounted yet — still honour the configured path
        return custom
    return CONFIG_DIR


DATA_DIR = _get_data_dir()
DB_PATH  = os.environ.get("VAULT_DB", os.path.join(DATA_DIR, "vault.db"))
DATABASE_URL = f"sqlite:///{DB_PATH.replace(os.sep, '/')}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

# SQLite performance tuning — applied once per connection
@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _rec):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")       # concurrent reads + writes
    cur.execute("PRAGMA synchronous=NORMAL")      # safe but faster than FULL
    cur.execute("PRAGMA cache_size=-32000")       # 32 MB page cache
    cur.execute("PRAGMA temp_store=MEMORY")       # temp tables in RAM
    cur.execute("PRAGMA mmap_size=268435456")     # 256 MB memory-mapped I/O
    cur.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
